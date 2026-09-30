import * as http from 'http';
import { config, validateConfig } from './config/env.js';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Minimal structured logger for the platform server.
 * In production this should be replaced with a full-featured logger (e.g. pino, winston).
 */
const logger = {
  info: (msg: string) => process.stdout.write(`[INFO]  ${new Date().toISOString()} ${msg}\n`),
  error: (msg: string, err?: unknown) => {
    process.stderr.write(`[ERROR] ${new Date().toISOString()} ${msg}\n`);
    if (err instanceof Error) {
      process.stderr.write(`        ${err.stack ?? err.message}\n`);
    }
  },
};

// Validate configuration strictly on boot — abort immediately if misconfigured
try {
  validateConfig(config);
  logger.info(`Configuration validated for environment: ${config.env}`);
} catch (error) {
  logger.error('Failed to start platform: configuration invalid.', error);
  process.exit(1);
}

const PORT = process.env.PORT ?? 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function parseRoute(url: string): { path: string; segments: string[] } {
  const path = url.split('?')[0] ?? url;
  const segments = path.split('/').filter(Boolean);
  return { path, segments };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, {
    status: 'ok',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
}

function handleDashboard(res: ServerResponse): void {
  // In a full implementation this would query the InMemoryRepository / database.
  // Returns the Status API payload consumed by the dashboard frontend.
  sendJson(res, 200, {
    verification_stages: [],
    execution_results: [],
    export_options: {
      available_formats: ['csv', 'json'],
      max_records: config.limits.maxRecords,
      max_size_mb: config.limits.maxExportSizeMb,
    },
    degraded_sources: [],
  });
}

function handleExecutionExport(
  res: ServerResponse,
  executionId: string,
  req: IncomingMessage
): void {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    let format = 'json';
    try {
      const parsed = JSON.parse(body) as { format?: string };
      format = parsed.format ?? 'json';
    } catch {
      // default to json if body is malformed
    }

    if (format !== 'csv' && format !== 'json') {
      sendJson(res, 400, { error: 'Invalid format. Must be "csv" or "json".' });
      return;
    }

    sendJson(res, 200, {
      download_url: `/api/executions/${executionId}/download?format=${format}`,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  });
}

function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not Found' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const { path, segments } = parseRoute(req.url ?? '/');
  const method = req.method ?? 'GET';

  logger.info(`${method} ${path}`);

  // GET /health
  if (method === 'GET' && path === '/health') {
    return handleHealth(res);
  }

  // GET /dashboard  ← consumed by the dashboard frontend via Vite proxy /api/dashboard
  if (method === 'GET' && path === '/dashboard') {
    return handleDashboard(res);
  }

  // POST /executions/:id/export
  if (
    method === 'POST' &&
    segments.length === 3 &&
    segments[0] === 'executions' &&
    segments[2] === 'export'
  ) {
    const executionId = segments[1] ?? 'unknown';
    return handleExecutionExport(res, executionId, req);
  }

  // OPTIONS preflight (CORS)
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  return handleNotFound(res);
});

server.listen(PORT, () => {
  logger.info(`AI Data Intelligence Platform running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => process.exit(0));
});
