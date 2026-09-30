import * as http from 'http';
import { config, validateConfig } from './config/env.js';

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

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        environment: config.env,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
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
