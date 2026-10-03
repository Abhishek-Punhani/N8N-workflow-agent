import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../config/env.js';
import { Store } from './store.js';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
function equal(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
}
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let length = 0;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    let rejected = false;
    req.on('data', (bytes: Buffer) => {
      length += bytes.length;
      if (length > 32768) {
        if (!rejected) {
          rejected = true;
          reject(new HttpError(413, 'Request body exceeds 32 KB'));
        }
        return;
      }
      chunks.push(bytes);
    });
    req.once('end', resolve);
    req.once('error', reject);
    req.once('aborted', () => reject(new HttpError(400, 'Request was interrupted')));
  });
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Request must contain a valid JSON object');
  }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function createApi(store: Store, config: AppConfig, token: string) {
  if (token.length < 32) throw new Error('PLATFORM_API_TOKEN must contain at least 32 characters');
  const attempts = new Map<string, { count: number; until: number }>();
  const sign = (expiry: string) =>
    createHmac('sha256', token).update(`session:${expiry}`).digest('hex');
  const authenticated = (req: IncomingMessage): boolean => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    if (bearer && equal(bearer, token)) return true;
    const cookie = req.headers.cookie
      ?.split(';')
      .map(s => s.trim())
      .find(s => s.startsWith('platform_session='))
      ?.slice(17);
    if (!cookie) return false;
    const [expiry, signature] = cookie.split('.');
    return Number(expiry) > Date.now() && Boolean(signature) && equal(signature, sign(expiry));
  };
  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (path === '/' && method === 'GET') {
        return json(res, 200, {
          service: 'forma-platform-api',
          status: 'ok',
          dashboard: 'http://localhost',
          health: '/health',
          readiness: '/ready',
        });
      }
      if (path === '/health' && method === 'GET') return json(res, 200, { status: 'ok' });
      if (path === '/ready' && method === 'GET') {
        try {
          await store.pool.query('SELECT 1');
          const n8n = await fetch(`${config.n8n.baseUrl}/healthz/readiness`, {
            signal: AbortSignal.timeout(3000),
          });
          if (!n8n.ok) throw new Error();
          return json(res, 200, { status: 'ready' });
        } catch {
          return json(res, 503, { status: 'unavailable' });
        }
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host)
        throw new HttpError(403, 'Cross-origin requests are not allowed');
      if (path === '/session' && method === 'POST') {
        const address = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
        const limit = attempts.get(address) ?? { count: 0, until: now + 60000 };
        if (++limit.count > 10)
          throw new HttpError(429, 'Too many sign-in attempts. Try again in a minute.');
        attempts.set(address, limit);
        const data = await body(req);
        if (typeof data.token !== 'string' || !equal(data.token, token))
          throw new HttpError(401, 'Invalid workspace access key');
        const expiry = String(Date.now() + 8 * 3600000);
        res.setHeader(
          'Set-Cookie',
          `platform_session=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`
        );
        return json(res, 200, { authenticated: true });
      }
      if (!authenticated(req)) throw new HttpError(401, 'Sign in with your workspace access key');
      if (path === '/session' && method === 'DELETE') {
        res.setHeader(
          'Set-Cookie',
          'platform_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        );
        return json(res, 200, { authenticated: false });
      }
      if (path === '/dashboard' && method === 'GET') {
        const jobs = await store.list();
        return json(res, 200, {
          execution_results: jobs,
          verification_stages: jobs[0]?.verification_stages ?? [],
          export_options: {
            available_formats: ['csv', 'json'],
            max_records: config.limits.maxRecords,
            max_size_mb: config.limits.maxExportSizeMb,
          },
          degraded_sources: [],
          model: config.llm.model,
        });
      }
      if (path === '/prompts' && method === 'POST') {
        const data = await body(req);
        if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 10000)
          throw new HttpError(400, 'Prompt must contain 1–10,000 characters');
        const active = await store.pool.query<{ count: string }>(
          "SELECT count(*) FROM platform_jobs WHERE status IN ('pending','running')"
        );
        if (Number(active.rows[0].count) >= 20)
          throw new HttpError(429, 'Workspace queue is full. Try again after current runs finish.');
        const job = await store.create(data.prompt.trim());
        return json(res, 202, job);
      }
      const match = path.match(
        /^\/executions\/([0-9a-f-]{36})(?:\/(records|export|download|retry))?$/i
      );
      if (match) {
        const job = await store.get(match[1]);
        if (!job) throw new HttpError(404, 'Execution not found');
        if (match[2] === 'retry' && method === 'POST') {
          if (!['failed', 'completed'].includes(job.status))
            throw new HttpError(409, 'Wait for this execution to finish before retrying');
          const active = await store.pool.query<{ count: string }>(
            "SELECT count(*) FROM platform_jobs WHERE status IN ('pending','running')"
          );
          if (Number(active.rows[0].count) >= 20)
            throw new HttpError(429, 'Workspace queue is full');
          const checkpoint = job.artifacts?.collection_checkpoint as
            import('./collection.js').CollectionCheckpoint | undefined;
          let artifacts: Record<string, unknown> | undefined;
          if (checkpoint && job.artifacts?.objective && job.artifacts.collection_version === 2) {
            const retry = structuredClone(checkpoint);
            retry.discovery_rounds = 0;
            // A user-initiated retry grants a fresh run budget while retaining evidence.
            retry.report = {
              ...retry.report,
              phase: 'collecting',
              coverage: 'in_progress',
              pages_visited: 0,
              model_calls: 0,
              stop_reason: undefined,
              warnings: [],
              sources: [],
              events: [],
              activity: undefined,
            };
            if (!retry.queue.length) {
              const failed = checkpoint.report.sources.filter(
                source => !['available', 'redirected'].includes(source.state)
              );
              const urls = failed.length ? failed.map(source => source.url) : checkpoint.visited;
              retry.queue = [...new Set(urls)].map(url => ({ url, depth: 0, priority: 100 }));
              retry.visited = retry.visited.filter(url => !urls.includes(url));
            }
            retry.visited = retry.visited.filter(
              url => !retry.queue.some(target => target.url === url)
            );
            artifacts = {
              objective: job.artifacts.objective,
              collection_version: 2,
              collection_checkpoint: retry,
              retry_of: job.execution_id,
            };
          }
          return json(res, 202, await store.create(job.prompt, artifacts));
        }
        if (!match[2] && method === 'GET') {
          const { artifacts: _artifacts, ...publicJob } = job;
          return json(res, 200, publicJob);
        }
        if (match[2] === 'records' && method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 25),
            offset = Number(url.searchParams.get('offset') ?? 0);
          if (
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            !Number.isSafeInteger(offset) ||
            offset < 0
          )
            throw new HttpError(
              400,
              'Invalid pagination; limit must be 1–100 and offset nonnegative'
            );
          return json(res, 200, {
            execution_id: job.execution_id,
            total_records: job.records_processed,
            records: await store.records(job.execution_id, limit, offset),
          });
        }
        if (match[2] === 'export' && method === 'POST') {
          const data = await body(req);
          if (data.format !== 'csv' && data.format !== 'json')
            throw new HttpError(400, 'Export format must be csv or json');
          if (job.status !== 'completed')
            throw new HttpError(409, 'Only completed executions can be exported');
          return json(res, 200, {
            download_url: `/api/executions/${job.execution_id}/download?format=${data.format}`,
          });
        }
        if (match[2] === 'download' && method === 'GET') {
          const format = url.searchParams.get('format');
          if (format !== 'csv' && format !== 'json')
            throw new HttpError(400, 'Export format must be csv or json');
          if (job.status !== 'completed')
            throw new HttpError(409, 'Only completed executions can be exported');
          if (job.records_processed > config.limits.maxRecords)
            throw new HttpError(413, 'Export exceeds record limit');
          const dir = await mkdtemp(join(tmpdir(), 'platform-export-'));
          const file = join(dir, 'export');
          let handle: FileHandle | undefined;
          try {
            handle = await open(file, 'wx', 0o600);
            let bytes = 0,
              count = 0;
            const objective = job.artifacts?.objective as
              import('../core/types.js').StructuredObjective | undefined;
            let fields: string[] = objective?.required_fields.map(field => field.name) ?? [];
            const write = async (text: string) => {
              bytes += Buffer.byteLength(text);
              if (bytes > config.limits.maxExportSizeMb * 1024 * 1024)
                throw new HttpError(413, 'Export exceeds size limit');
              await handle!.write(text);
            };
            if (format === 'json') await write('[');
            for (let offset = 0; offset < job.records_processed; offset += 1000) {
              for (const record of await store.records(job.execution_id, 1000, offset)) {
                if (format === 'json') await write((count ? ',' : '') + JSON.stringify(record));
                else {
                  if (!count) {
                    fields = [...new Set([...fields, ...Object.keys(record)])];
                    await write(fields.map(csvCell).join(',') + '\r\n');
                  }
                  await write(fields.map(f => csvCell(record[f])).join(',') + '\r\n');
                }
                count++;
              }
            }
            if (format === 'json') await write(']');
            await handle.close();
            handle = undefined;
            res.writeHead(200, {
              'Content-Type': format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="dataset-${job.execution_id}.${format}"`,
              'Content-Length': bytes,
            });
            await pipeline(createReadStream(file), res);
          } finally {
            await handle?.close();
            await rm(dir, { recursive: true, force: true });
          }
          return;
        }
      }
      throw new HttpError(404, 'Not found');
    })().catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!(error instanceof HttpError)) process.stderr.write('API request failed\n');
      json(res, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'Internal server error',
      });
    });
  });
}
