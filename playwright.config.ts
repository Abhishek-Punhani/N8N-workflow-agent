import { defineConfig } from '@playwright/test';
import 'dotenv/config';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080', headless: true, screenshot: 'only-on-failure', trace: 'off' },
  reporter: [['list']],
});
