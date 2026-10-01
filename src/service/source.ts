import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false; // Resolve and pin public IPv4; IPv6-only sources are rejected explicitly.
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}

/** Pin the validated address to prevent DNS rebinding; reject redirects and private networks. */
export async function fetchSource(raw: string, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Sources must use HTTPS on port 443 without embedded credentials');
  }
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Source resolves to a blocked network');
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET',
      family: 4,
      headers: { accept: 'application/json', 'user-agent': 'DataIntelligence/1.0' },
      lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
    }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Source returned HTTP ${res.statusCode}; redirects are not followed`)); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { req.destroy(new Error('Source exceeds the 10 MB acquisition limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
        catch { reject(new Error('Source did not return valid JSON. HTML extraction is not supported by this release.')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Source request timed out')), 30000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}
