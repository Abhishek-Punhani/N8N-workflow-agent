import { assertSafeUrl } from './source.js';

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}
export interface SearchConfig {
  provider: 'searxng' | 'tavily' | 'brave';
  baseUrl: string;
  apiKey: string;
}

export function searchConfig(): SearchConfig {
  const provider = process.env.SEARCH_PROVIDER || 'searxng';
  if (!['searxng', 'tavily', 'brave'].includes(provider))
    throw new Error('Invalid SEARCH_PROVIDER');
  return {
    provider: provider as SearchConfig['provider'],
    baseUrl: process.env.SEARCH_BASE_URL || 'http://localhost:8081',
    apiKey: process.env.SEARCH_API_KEY || '',
  };
}

export async function searchWeb(
  query: string,
  signal: AbortSignal,
  config = searchConfig()
): Promise<SearchHit[]> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let url: URL;
  let body: string | undefined;
  if (config.provider === 'searxng') {
    // Operator-configured connector, never derived from model output or a page.
    url = new URL('/search', config.baseUrl);
    url.search = new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
      language: 'en',
    }).toString();
  } else {
    if (!config.apiKey) throw new Error(`SEARCH_API_KEY is required for ${config.provider}`);
    if (config.provider === 'tavily') {
      url = new URL('https://api.tavily.com/search');
      headers['content-type'] = 'application/json';
      body = JSON.stringify({
        api_key: config.apiKey,
        query,
        max_results: 10,
        include_raw_content: false,
      });
    } else {
      url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.search = new URLSearchParams({ q: query, count: '10' }).toString();
      headers['X-Subscription-Token'] = config.apiKey;
    }
  }
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers,
    body,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (!response.ok)
    throw new Error(`Search connector ${config.provider} returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Search response exceeds limit');
  const data = JSON.parse(text) as {
    results?: unknown[];
    web?: { results?: unknown[] };
    unresponsive_engines?: unknown[];
  };
  const hits: SearchHit[] = [];
  for (const value of (config.provider === 'brave' ? data.web?.results : data.results) ?? []) {
    if (!value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    try {
      const safe = assertSafeUrl(String(r.url));
      safe.hash = '';
      hits.push({
        url: safe.href,
        title: String(r.title ?? ''),
        snippet: String(r.content ?? r.description ?? '').slice(0, 2000),
      });
    } catch {
      /* Unsafe or unsupported search hits are not acquisition targets. */
    }
  }
  if (!hits.length)
    throw new Error(
      `Search connector ${config.provider} returned no usable results${data.unresponsive_engines?.length ? '; upstream engines are unavailable' : ''}`
    );
  return hits.slice(0, 20);
}
