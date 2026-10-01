import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
const base = process.env.N8N_BASE_URL;
const secretFile = '/shared/n8n-api-key';
const request = async (path, body, cookie) => {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return response;
};
try {
  const key = await readFile(secretFile, 'utf8');
  const check = await fetch(`${base}/api/v1/workflows?limit=1`, { headers: { 'X-N8N-API-KEY': key.trim() }, signal: AbortSignal.timeout(10000) });
  if (check.ok) { console.log('Existing n8n API credential verified'); process.exit(0); }
} catch { /* First installation has no key file. */ }
const { N8N_OWNER_EMAIL: email, N8N_OWNER_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('N8N_OWNER_EMAIL and N8N_OWNER_PASSWORD are required');
const setup = await request('/rest/owner/setup', { email, password, firstName: 'Platform', lastName: 'Owner' });
if (!setup.ok && setup.status !== 400) throw new Error(`n8n setup failed (${setup.status})`);
const login = await request('/rest/login', { emailOrLdapLoginId: email, password });
if (!login.ok) throw new Error(`n8n login failed (${login.status}); verify owner credentials`);
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const response = await request('/rest/api-keys', { label: 'Data Intelligence Platform', expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400, scopes: ['workflow:create','workflow:read','workflow:update','workflow:delete','workflow:activate','workflow:deactivate','workflow:list','execution:read','execution:list'] }, cookie);
if (!response.ok) throw new Error(`n8n API key creation failed (${response.status})`);
const json = await response.json();
const key = json.data?.rawApiKey ?? json.data?.apiKey;
if (typeof key !== 'string' || key.length < 20) throw new Error('n8n returned no API key');
await mkdir('/shared', { recursive: true });
await writeFile(secretFile, key, { mode: 0o640 });
await chmod(secretFile, 0o644); // volume is mounted only by the two application services
console.log('n8n configured; credential saved to private Docker volume');
