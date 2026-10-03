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
    ...(objective?.required_fields ?? []).map(
      field => `${field.name.replace(/_/g, ' ')} ${field.description ?? ''}`
    ),
    ...(objective?.constraints ?? []).map(c => JSON.stringify(c.value ?? '')),
  ].join(' ');
  const counts = new Map<string, number>();
  for (const term of source.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (STOPWORDS.has(term) || (/^\d+$/.test(term) && term.length !== 4)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.keys()];
}

// These often require login or block acquisition; use a soft priority penalty.
const LOW_VALUE_HOST =
  /(^|\.)(facebook|instagram|twitter|x|tiktok|pinterest|youtube|youtu|reddit|quora|linkedin|t)\.(com|be|co)$/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export function scoreHit(
  hit: SearchHit,
  terms: string[],
  position: number,
  seedHosts: Set<string>
): number {
  const host = hostOf(hit.url);
  if (!host) return -1;
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
  // Public social/profile pages may be the only relevant source for some requests.
  // Deprioritize them; fetching and evidence verification determine usability.
  return Math.max(0, score + Math.max(0, 3 - position * 0.1) - (LOW_VALUE_HOST.test(host) ? 2 : 0));
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
  if (limit <= 0) return [];
  const urls = new Set<string>();
  const scored = hits
    .filter(hit => {
      try {
        const url = new URL(hit.url);
        if (url.protocol !== 'https:' || url.username || url.password) return false;
        url.hash = '';
        for (const key of [...url.searchParams.keys()])
          if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
        if (urls.has(url.href)) return false;
        urls.add(url.href);
        return true;
      } catch {
        return false;
      }
    })
    .map((hit, position) => ({ hit, score: scoreHit(hit, terms, position, seedHosts) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Map<string, number>();
  const out: SearchHit[] = [];
  const deferred: SearchHit[] = [];
  for (const { hit } of scored) {
    const host = hostOf(hit.url);
    const count = seen.get(host) ?? 0;
    if (count >= perHost) {
      deferred.push(hit);
      continue;
    }
    seen.set(host, count + 1);
    out.push(hit);
    if (out.length >= limit) break;
  }
  // Diversity affects order, not recall when one domain holds most useful detail pages.
  return out.concat(deferred).slice(0, limit);
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
    if (!host) continue;
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
    if (
      /(^|[\s/_.-])(contact|about|team|careers?|jobs?|people|details?|branches|locations?)(?=$|[\s/_.-])/i.test(
        `${link.label} ${path}`
      )
    )
      score += 2;
    if (/\d/.test(path) || path.split('/').filter(Boolean).length >= 2) score += 0.5;
    if (host === origin) score += 0.5;
    if (LOW_VALUE_HOST.test(host)) score -= 1;
    if (score > 0) scored.push({ link, score });
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
  organisation: 'organization',
  telephone: 'phone',
  link: 'url',
  href: 'url',
  uri: 'url',
  website: 'url',
  cost: 'price',
  summary: 'description',
  details: 'description',
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
    if (typeof value === 'string' && value.trim()) out.push({ path, key, value });
    else if (typeof value === 'number' && Number.isFinite(value)) out.push({ path, key, value });
    else if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2)
      out.push(...leaves(value as Record<string, unknown>, depth + 1, path));
  }
  return out;
}

function coerce(
  value: string | number,
  type: FieldDefinition['type']
): string | number | undefined {
  switch (type) {
    case 'number': {
      const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'url':
      try {
        const url = new URL(String(value));
        // Preserve the literal source value so canonicalization cannot invent evidence.
        return /^https?:$/.test(url.protocol) ? String(value) : undefined;
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
  evidence: Record<string, { quote: string; context: string }>;
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
  const walk = (node: unknown, depth = 0): void => {
    if (depth > 30 || budget-- <= 0 || out.length >= limit || !node || typeof node !== 'object')
      return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const object = node as Record<string, unknown>;
    const context = JSON.stringify(object);
    const flat = leaves(object);
    const values: Record<string, unknown> = {};
    const evidence: Record<string, { quote: string; context: string }> = {};
    const usedPaths = new Set<string>();
    for (const field of fields) {
      const matches = flat
        .filter(
          leaf => !usedPaths.has(leaf.path) && fieldMatchesPath(field.name, leaf.path, entityTokens)
        )
        .sort((a, b) => a.path.length - b.path.length);
      if (!matches.length) continue;
      // Competing mapped values are never resolved by path length alone.
      if (matches.some(match => match.value !== matches[0].value)) continue;
      const leaf = matches[0];
      const value = coerce(leaf.value, field.type);
      if (value === undefined) continue;
      if (context.length > 6000) continue;
      usedPaths.add(leaf.path);
      values[field.name] = value;
      // Review sees the enclosing entity and nested relationships, not an isolated value.
      // Large objects fall back to text extraction rather than truncated attribution.
      evidence[field.name] = {
        quote: JSON.stringify({ [leaf.key]: leaf.value }).slice(1, -1),
        context,
      };
    }
    if (requiredFields.every(field => values[field.name] !== undefined)) {
      const key = JSON.stringify(values);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ values, evidence });
      }
    }
    for (const child of Object.values(object)) walk(child, depth + 1);
  };
  for (const root of roots) walk(root);
  return out;
}
