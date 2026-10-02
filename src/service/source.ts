import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export interface HttpBody {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

const USER_AGENT = 'FormaDataIntelligence/1.0 (+https://localhost)';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false; // Resolve and pin public IPv4; IPv6-only sources are rejected explicitly.
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function assertSafeUrl(raw: string): URL {
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

export class SourceAccessError extends Error {
  constructor(
    public readonly state:
      'challenge' | 'authentication' | 'rate_limited' | 'denied' | 'unavailable',
    message: string
  ) {
    super(message);
  }
}

export function checkSourceAccess(body: string, status: number): void {
  // A contact-form CAPTCHA widget or an article mentioning CAPTCHA is not an access wall.
  const text = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /cf-chl-|challenge-platform|id=["']challenge-form/i.test(body) ||
    (text.length < 4000 &&
      /verify (?:that )?you (?:are|’re|'re) human|unusual traffic|checking your browser|complete the (?:security check|captcha)|enable javascript and cookies to continue/i.test(
        text
      ))
  ) {
    throw new SourceAccessError(
      'challenge',
      'Human verification required; this source needs an authorized session or an alternative source'
    );
  }
  if (status === 401)
    throw new SourceAccessError('authentication', 'Source requires authentication');
  if (status === 429) throw new SourceAccessError('rate_limited', 'Source rate limit reached');
  if (status === 403) throw new SourceAccessError('denied', 'Source denied access');
  if (status !== 200) throw new SourceAccessError('unavailable', `Source returned HTTP ${status}`);
}

export async function fetchText(
  raw: string,
  accept = 'application/json, text/html, application/xml;q=0.9, */*;q=0.5',
  maxBytes = 10 * 1024 * 1024,
  redirects = 0,
  signal?: AbortSignal
): Promise<HttpBody> {
  const url = assertSafeUrl(raw);
  signal?.throwIfAborted();
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address)))
    throw new Error('Source resolves to a blocked network');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        family: 4,
        headers: { accept, 'user-agent': USER_AGENT },
        lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
      },
      res => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (redirects >= 5) reject(new Error('Source exceeded the redirect limit'));
          else
            fetchText(new URL(location, url).href, accept, maxBytes, redirects + 1, signal).then(
              resolve,
              reject
            );
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            req.destroy(new Error(`Source exceeds the ${maxBytes} byte acquisition limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            checkSourceAccess(body, status);
          } catch (error) {
            reject(error);
            return;
          }
          resolve({
            url: url.href,
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

/** JSON transport for older callers; general collection lives in collection.ts. */
export async function fetchSource(raw: string, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
  const response = await fetchText(raw, 'application/json', maxBytes);
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(
      'Source did not return valid JSON. Use the general collection engine for HTML sources.'
    );
  }
}
