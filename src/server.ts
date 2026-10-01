import { readFile } from 'node:fs/promises';
import { config, validateConfig } from './config/env.js';
import { Store } from './service/store.js';
import { createApi } from './service/http.js';
import { runJob } from './service/pipeline.js';

async function main(): Promise<void> {
  if (process.env.N8N_API_KEY_FILE) config.n8n.apiKey = (await readFile(process.env.N8N_API_KEY_FILE, 'utf8')).trim();
  validateConfig(config);
  const token = process.env.PLATFORM_API_TOKEN ?? '';
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const store = new Store();
  await store.init();
  const server = createApi(store, config, token);
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(port, '0.0.0.0', () => process.stdout.write(`Platform listening on ${port}; model=${config.llm.model}\n`));
  let stopping = false;
  const worker = (async () => {
    while (!stopping) {
      try {
        await store.reconcile();
        const job = await store.claim();
        if (job) { await runJob(store, job, config); continue; }
      } catch { process.stderr.write('Worker iteration failed; retrying\n'); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  })();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close();
    const timer = setTimeout(() => process.exit(1), 25000); timer.unref();
    void worker.then(() => store.pool.end()).then(() => { clearTimeout(timer); process.exit(0); });
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
void main().catch((error: unknown) => { process.stderr.write(`Startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exit(1); });
