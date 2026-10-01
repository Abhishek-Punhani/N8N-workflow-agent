import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export interface AcquisitionResult {
  records: Record<string, unknown>[];
  source: string;
  mode: 'json' | 'web';
  discovered_urls: string[];
}

interface HttpBody {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

const DEFAULT_WEB_PAGE_LIMIT = 80;
const USER_AGENT = 'FormaDataIntelligence/1.0 (+https://localhost)';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false; // Resolve and pin public IPv4; IPv6-only sources are rejected explicitly.
  const [a, b] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new Error('Sources must use HTTPS on port 443 without embedded credentials');
  }
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockedByAutomation(body: string, status: number): boolean {
  if (
    [401, 403, 429, 503].includes(status) &&
    /captcha|robot|bot|cloudflare|access denied|verify you are human|unusual traffic/i.test(body)
  ) {
    return true;
  }
  return /g-recaptcha|hcaptcha|cf-chl|verify you are human|captcha/i.test(body);
}

async function fetchText(
  raw: string,
  accept = 'application/json, text/html, application/xml;q=0.9, */*;q=0.5',
  maxBytes = 10 * 1024 * 1024
): Promise<HttpBody> {
  const url = assertSafeUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address)))
    throw new Error('Source resolves to a blocked network');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        family: 4,
        headers: { accept, 'user-agent': USER_AGENT },
        lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
      },
      res => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          reject(new Error(`Source returned HTTP ${status}; redirects are not followed`));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            req.destroy(new Error('Source exceeds the 10 MB acquisition limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (blockedByAutomation(body, status)) {
            reject(
              new Error(
                'Source is protected by a bot check or CAPTCHA. Provide an official API/export or an authenticated connector; this platform will not bypass CAPTCHA walls.'
              )
            );
            return;
          }
          if (status !== 200) {
            reject(new Error(`Source returned HTTP ${status}`));
            return;
          }
          resolve({
            url: raw,
            status,
            contentType: String(res.headers['content-type'] ?? ''),
            body,
          });
        });
      }
    );
    const timer = setTimeout(() => req.destroy(new Error('Source request timed out')), 30000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

function toRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value) && value.every(r => r && typeof r === 'object' && !Array.isArray(r)))
    return value as Record<string, unknown>[];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['records', 'items', 'products', 'data', 'results']) {
      const child = (value as Record<string, unknown>)[key];
      const records = toRecordArray(child);
      if (records) return records;
    }
  }
  return null;
}

function parseXmlLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(match =>
    decodeHtml(match[1].trim())
  );
}

function sameOrigin(url: string, origin: URL): boolean {
  try {
    return new URL(url, origin).origin === origin.origin;
  } catch {
    return false;
  }
}

function absolutize(url: string, base: URL): string | null {
  try {
    const parsed = new URL(decodeHtml(url), base);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function likelyProductUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return (
      /(^|\/)(p|product|products|item|dp)\//.test(path) &&
      !/\.(jpg|png|webp|svg|css|js)$/i.test(path)
    );
  } catch {
    return false;
  }
}

function extractLinks(html: string, base: URL): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    const href = absolutize(match[1], base);
    if (href && sameOrigin(href, base) && likelyProductUrl(href)) urls.add(href);
  }
  return [...urls];
}

async function discoverFromSitemap(base: URL, limit: number): Promise<string[]> {
  const sitemap = await fetchText(
    new URL('/sitemap.xml', base).href,
    'application/xml, text/xml, */*;q=0.5'
  ).catch(() => null);
  const first = sitemap ? parseXmlLocations(sitemap.body).filter(url => sameOrigin(url, base)) : [];
  const productLike = first.filter(likelyProductUrl);
  if (productLike.length) return productLike.slice(0, limit);
  const nested = [
    ...first.filter(url => /sitemap|product|collection/i.test(url)),
    new URL('/feed/sitemapproduct.xml', base).href,
    new URL('/sitemap_products_1.xml', base).href,
  ].slice(0, 10);
  const out: string[] = [];
  for (const url of nested) {
    if (out.length >= limit) break;
    const body = await fetchText(url, 'application/xml, text/xml, */*;q=0.5').catch(() => null);
    if (!body) continue;
    for (const loc of parseXmlLocations(body.body)) {
      if (sameOrigin(loc, base) && likelyProductUrl(loc)) out.push(loc);
      if (out.length >= limit) break;
    }
  }
  return [...new Set(out)].slice(0, limit);
}

function parseJsonLdProducts(html: string, pageUrl: string): Record<string, unknown>[] {
  const products: Record<string, unknown>[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = decodeHtml(match[1]).trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const queue: unknown[] = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const graph = record['@graph'];
        if (Array.isArray(graph)) queue.push(...(graph as unknown[]));
        if (
          record['@type'] === 'Product' ||
          (Array.isArray(record['@type']) && record['@type'].includes('Product'))
        ) {
          const offers = record.offers;
          const offer = Array.isArray(offers) ? (offers as unknown[])[0] : offers;
          const price =
            offer && typeof offer === 'object'
              ? Number((offer as Record<string, unknown>).price)
              : Number(record.price);
          products.push({
            title: cleanText(record.name),
            name: cleanText(record.name),
            price: Number.isFinite(price) ? price : undefined,
            category: cleanText(record.category),
            sku: cleanText(record.sku),
            url: typeof record.url === 'string' ? record.url : pageUrl,
            source_url: pageUrl,
          });
        }
      }
    } catch {
      continue;
    }
  }
  return products.filter(product => product.title);
}

function categoryFromBreadcrumbs(value: unknown): string {
  const crumbs = Array.isArray(value) ? value : [];
  const titles: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.title === 'string') titles.push(record.title);
    if (record.childSlug) walk(record.childSlug);
    if (record.slug && typeof record.slug === 'object') walk(record.slug);
  };
  crumbs.forEach(walk);
  return titles.length ? titles[titles.length - 1] : '';
}

function normalizeProductApi(data: unknown, pageUrl: string): Record<string, unknown> | null {
  const product =
    data && typeof data === 'object' ? ((data as Record<string, unknown>).result ?? data) : null;
  if (!product || typeof product !== 'object') return null;
  const record = product as Record<string, unknown>;
  const priceObject =
    record.price && typeof record.price === 'object'
      ? (record.price as Record<string, unknown>)
      : {};
  const raw =
    priceObject.raw && typeof priceObject.raw === 'object'
      ? (priceObject.raw as Record<string, unknown>)
      : {};
  const worth =
    record.worth && typeof record.worth === 'object'
      ? (record.worth as Record<string, unknown>)
      : {};
  const worthRaw =
    worth.raw && typeof worth.raw === 'object' ? (worth.raw as Record<string, unknown>) : {};
  const price = Number(raw.withTax ?? worthRaw.withTax ?? record.price);
  const title = cleanText(record.name ?? record.title);
  if (!title) return null;
  const canonical = typeof record.canonicalTags === 'string' ? record.canonicalTags : pageUrl;
  return {
    title,
    name: title,
    price: Number.isFinite(price) ? price : undefined,
    category: categoryFromBreadcrumbs(record.breadCrumbs),
    sku: cleanText(record.stockCode ?? record.sku ?? record.productCode),
    url: canonical,
    source_url: canonical,
  };
}

async function discoverProductApi(
  pageUrl: string,
  html: string
): Promise<Record<string, unknown> | null> {
  const url = new URL(pageUrl);
  if (!html.includes('/api/catalog/product/slug-middleware') && !url.pathname.startsWith('/p/'))
    return null;
  const slug = url.pathname.replace(/^\/+/, '');
  if (!slug) return null;
  const endpoint = new URL(
    `/api/catalog/product/slug-middleware?slug=${encodeURIComponent(slug)}`,
    url
  ).href;
  const response = await fetchText(endpoint, 'application/json').catch(() => null);
  if (!response) return null;
  try {
    return normalizeProductApi(JSON.parse(response.body), pageUrl);
  } catch {
    return null;
  }
}

async function mapLimited<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      const mapped = await mapper(item).catch(() => null);
      if (mapped) results.push(mapped);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchWebProducts(raw: string, limit: number): Promise<AcquisitionResult> {
  const base = assertSafeUrl(raw);
  const page = await fetchText(
    base.href,
    'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.5'
  );
  const initialProducts = parseJsonLdProducts(page.body, base.href);
  const directApi = await discoverProductApi(base.href, page.body);
  const discovered = new Set<string>(extractLinks(page.body, base));
  for (const url of await discoverFromSitemap(base, limit)) discovered.add(url);
  if (likelyProductUrl(base.href)) discovered.add(base.href);
  const targets = [...discovered].slice(0, limit);
  const products = await mapLimited(targets, 3, async url => {
    const html = await fetchText(url, 'text/html, application/xhtml+xml, */*;q=0.5');
    return (
      (await discoverProductApi(url, html.body)) ?? parseJsonLdProducts(html.body, url)[0] ?? null
    );
  });
  const records: Record<string, unknown>[] = [
    ...(directApi ? [directApi] : []),
    ...initialProducts,
    ...products,
  ]
    .filter(record => record.title && record.price !== undefined)
    .map(record => ({
      ...record,
      category: record.category || new URL(raw).hostname.replace(/^www\./, ''),
    }));
  const unique = new Map<string, Record<string, unknown>>();
  for (const record of records) unique.set(String(record.url ?? record.title), record);
  if (!unique.size)
    throw new Error(
      'No extractable product records found. The site may require JavaScript, authentication, or an official catalog API.'
    );
  return {
    records: [...unique.values()],
    source: base.href,
    mode: 'web',
    discovered_urls: targets,
  };
}

export async function acquireSource(
  raw: string,
  webLimit = DEFAULT_WEB_PAGE_LIMIT
): Promise<AcquisitionResult> {
  const response = await fetchText(raw);
  try {
    const parsed = JSON.parse(response.body) as unknown;
    const records = toRecordArray(parsed);
    if (!records?.length) throw new Error('Source JSON does not contain a record array');
    return { records, source: raw, mode: 'json', discovered_urls: [raw] };
  } catch {
    if (!/html|xml|text/i.test(response.contentType)) {
      throw new Error('Source did not return JSON or extractable HTML');
    }
    return fetchWebProducts(raw, webLimit);
  }
}

/** Backward-compatible helper for tests and older callers. */
export async function fetchSource(raw: string, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
  const response = await fetchText(raw, 'application/json', maxBytes);
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(
      'Source did not return valid JSON. HTML extraction is available through acquireSource.'
    );
  }
}
