import * as http from 'http';
import { config, validateConfig } from './config/env.js';

// Validate configuration strictly on boot
try {
  validateConfig(config);
  console.log(`Configuration validated for environment: ${config.env}`);
} catch (error) {
  console.error('Failed to start platform: ', error);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// Basic HTTP Server to expose health checks
// In a full implementation, this might wrap Express/Fastify and the PlatformOrchestrator
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
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`AI Data Intelligence Platform is running on port ${PORT}`);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
