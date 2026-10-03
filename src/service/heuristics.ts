import { load } from 'cheerio';
import type { FieldDefinition, StructuredObjective } from '../core/types.js';
import type { SearchHit } from './search.js';

/**
 * Deterministic, prompt-agnostic helpers. Nothing here knows about any particular
 * domain, website or request: everything is derived from the user's own words and the
 * structured objective. They replace model calls whose answers are mechanical.
 */

const STOPWORDS = new Set(
  (
    'the and with from that this these those have has had for are was were will would should could can may ' +
    'all any each every some such into onto over under about across between within without also than then ' +
    'them they their there here your you our out only more most other another which what when where who whom ' +
    'collect find get give list show return provide include including exclude excluding available currently ' +
    'current open new group filter allow need want please data dataset records record information details ' +
    'https http www com org net'
  ).split(' ')
);

export function intentTerms(prompt: string, objective?: StructuredObjective): string[] {
  const source = [
    prompt,
    objective?.target_entity ?? '',
    ...(objective?.qualification_requirements ?? []),
    ...(objective?.constraints ?? []).map(c => JSON.stringify(c.value ?? '')),
  ].join(' ');
  const counts = new Map<string, number>();
  for (const term of source.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (STOPWORDS.has(term) || /^\d+$/.test(term) && term.length !== 4) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.keys()];
}

// Hosts that are not citable evidence sources for general collection (social/video/Q&A).
const LOW_VALUE_HOST =
  /(^|\.)(facebook|instagram|twitter|x|tiktok|pinterest|youtube|youtu|reddit|quora|linkedin|t)\.(com|be|co)$/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export function scoreHit(hit: SearchHit, terms: string[], position: number, seedHosts: Set<string>): number {
  const host = hostOf(hit.url);
  if (!host || LOW_VALUE_HOST.test(host)) return -1;
  const title = hit.title.toLowerCase();
  const rest = `${hit.snippet} ${hit.url}`.toLowerCase();
  const labels = host.split('.').flatMap(label => label.split('-'));
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 2;
    else if (rest.includes(term)) score += 1;
    // A host named after something the user asked about (an entity's own domain) is
    // usually the authoritative source for that entity.
    if (term.length >= 4 && labels.includes(term)) score += 4;
  }
  if (seedHosts.has(host)) score += 10;
  return score + Math.max(0, 3 - position * 0.1);
}

/** Rank search hits without a model: relevance to the request, then host diversity. */
export function rankHits(
  hits: SearchHit[],
  terms: string[],
  seedUrls: string[],
  limit = 15,
  perHost = 3
): SearchHit[] {
  const seedHosts = new Set(seedUrls.map(hostOf).filter(Boolean));
  const scored = hits
    .map((hit, position) => ({ hit, score: scoreHit(hit, terms, position, seedHosts) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
  const strong = scored.filter(entry => entry.score >= 3);
  // When nothing overlaps the request, keep engine order instead of returning nothing.
  const pool = strong.length ? strong : scored.slice(0, 5);
  const seen = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const { hit } of pool) {
    const host = hostOf(hit.url);
    const count = seen.get(host) ?? 0;
    if (count >= perHost) continue;
    seen.set(host, count + 1);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

const NAV_NOISE =
  /(log-?in|sign-?in|sign-?up|register|cart|checkout|privacy|terms|cookie|unsubscribe|account|password|mailto:|tel:|javascript:|\/share|\/feed|\.rss)/i;
const PAGINATION_LABEL = /^(next|next page|more|load more|older|show more|›|»|>|→)$/i;
const PAGINATION_URL = /([?&](page|p|pg|offset|start|from)=\d+|\/page\/\d+|\/p\/\d+$)/i;

export interface ObservedLink {
  id: number;
  url: string;
  label: string;
}

/** Pick promising observed links (detail pages and pagination) without a model. */
export function pickLinks(
  links: ObservedLink[],
  terms: string[],
  visited: Set<string>,
  originUrl: string,
  limit = 6
): ObservedLink[] {
  const origin = hostOf(originUrl);
  const scored: Array<{ link: ObservedLink; score: number }> = [];
  for (const link of links) {
    if (visited.has(link.url)) continue;
    const host = hostOf(link.url);
    if (!host || LOW_VALUE_HOST.test(host)) continue;
    let path = '';
    try {
      path = new URL(link.url).pathname;
    } catch {
      continue;
    }
    if (NAV_NOISE.test(link.url) || NAV_NOISE.test(link.label)) continue;
    const label = link.label.toLowerCase();
    const target = `${path} ${link.url}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (label.includes(term)) score += 2;
      else if (target.includes(term)) score += 1;
    }
    if (PAGINATION_LABEL.test(link.label.trim()) || PAGINATION_URL.test(link.url)) score += 3;
    if (/\d/.test(path) || path.split('/').filter(Boolean).length >= 2) score += 0.5;
    if (host === origin) score += 0.5;
    if (score >= 2) scored.push({ link, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.link);
}

// ---------------------------------------------------------------------------
// Structured-data extraction: the model is only needed to read unstructured text.
// Many pages publish JSON-LD / framework data; when it maps *exactly* onto the
// requested schema we can lift literal values with no model call.
// ---------------------------------------------------------------------------

const SYNONYMS: Record<string, string> = {
  title: 'name',
  headline: 'name',
  label: 'name',
  organization: 'org',
  organisation: 'org',
  company: 'org',
  employer: 'org',
  hiring: 'org',
  business: 'org',
  brand: 'org',
  publisher: 'org',
  manufacturer: 'org',
  link: 'url',
  href: 'url',
  uri: 'url',
  website: 'url',
  salary: 'price',
  pay: 'price',
  cost: 'price',
  amount: 'price',
  wage: 'price',
  compensation: 'price',
  summary: 'description',
  details: 'description',
  expires: 'date',
  deadline: 'date',
  validthrough: 'date',
  posted: 'date',
  published: 'date',
};
// Tokens that carry no meaning of their own when they trail a more specific token.
const NEUTRAL = new Set(['name', 'value', 'text', 'content']);

function tokens(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(token => {
      const singular = token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
      return SYNONYMS[singular] ?? singular;
    });
}

function fieldMatchesPath(field: string, path: string, entityTokens: Set<string>): boolean {
  let want = [...new Set(tokens(field))];
  const specific = want.filter(token => !entityTokens.has(token));
  if (specific.length) want = specific;
  const have = [...new Set(tokens(path))];
  if (!want.every(token => have.includes(token))) return false;
  return have.every(token => want.includes(token) || NEUTRAL.has(token) || entityTokens.has(token));
}

type Leaf = { path: string; key: string; value: string | number };

function leaves(node: Record<string, unknown>, depth = 0, prefix = ''): Leaf[] {
  const out: Leaf[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' && value.trim()) out.push({ path, key, value: value.trim() });
    else if (typeof value === 'number' && Number.isFinite(value)) out.push({ path, key, value });
    else if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2)
      out.push(...leaves(value as Record<string, unknown>, depth + 1, path));
  }
  return out;
}

function coerce(value: string | number, type: FieldDefinition['type']): string | number | undefined {
  switch (type) {
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'url':
      try {
        const url = new URL(String(value));
        return /^https?:$/.test(url.protocol) ? url.href : undefined;
      } catch {
        return undefined;
      }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? String(value) : undefined;
    case 'array':
    case 'object':
      return undefined;
    default:
      return typeof value === 'number' ? String(value) : value;
  }
}

export interface StructuredRecord {
  values: Record<string, unknown>;
  evidence: Record<string, { quote: string }>;
}

/**
 * Extract records from embedded JSON (JSON-LD, __NEXT_DATA__). A record is emitted only
 * when every required field maps unambiguously onto a literal value; otherwise the page
 * falls back to model extraction. Quotes are the literal serialized `"key":value` pair.
 */
export function extractStructuredRecords(
  html: string,
  objective: StructuredObjective,
  limit = 50
): StructuredRecord[] {
  const fields = objective.required_fields;
  if (!fields.length) return [];
  const requiredFields = fields.filter(field => field.required);
  if (!requiredFields.length) return [];
  const entityTokens = new Set(tokens(objective.target_entity));
  const $ = load(html);
  const roots: unknown[] = [];
  $('script[type="application/ld+json"], script#__NEXT_DATA__').each((_, element) => {
    const text = $(element).text();
    if (text.length > 1_000_000) return;
    try {
      roots.push(JSON.parse(text));
    } catch {
      /* Invalid embedded JSON is not evidence. */
    }
  });
  const out: StructuredRecord[] = [];
  const seen = new Set<string>();
  let budget = 20_000;
  const walk = (node: unknown): void => {
    if (budget-- <= 0 || out.length >= limit || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const object = node as Record<string, unknown>;
    const flat = leaves(object);
    const values: Record<string, unknown> = {};
    const evidence: Record<string, { quote: string }> = {};
    const usedPaths = new Set<string>();
    for (const field of fields) {
      const matches = flat
        .filter(leaf => !usedPaths.has(leaf.path) && fieldMatchesPath(field.name, leaf.path, entityTokens))
        .sort((a, b) => a.path.length - b.path.length);
      if (!matches.length) continue;
      // Ambiguity (same-depth leaves with different values) is never guessed.
      if (matches.length > 1 && matches[1].path.length === matches[0].path.length && matches[1].value !== matches[0].value)
        continue;
      const leaf = matches[0];
      const value = coerce(leaf.value, field.type);
      if (value === undefined) continue;
      usedPaths.add(leaf.path);
      values[field.name] = value;
      evidence[field.name] = { quote: JSON.stringify({ [leaf.key]: leaf.value }).slice(1, -1) };
    }
    if (requiredFields.every(field => values[field.name] !== undefined)) {
      const key = JSON.stringify(values);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ values, evidence });
      }
    }
    for (const child of Object.values(object)) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}
