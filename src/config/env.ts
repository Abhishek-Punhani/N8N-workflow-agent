import * as dotenv from 'dotenv';
import { DEFAULT_TIMEOUTS } from '../core/config.js';

// Load .env if present
dotenv.config();

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface AppConfig {
  env: Environment;

  llm: {
    apiKey: string;
    endpoint: string;
    model: string;
  };

  n8n: {
    baseUrl: string;
    apiKey: string;
  };

  limits: {
    maxRecords: number;
    maxExportSizeMb: number;
  };

  timeouts: {
    llmRequestMs: number;
    n8nRequestMs: number;
  };
}

/**
 * Validate and load the configuration from environment variables.
 * Falls back to environment-specific defaults where appropriate.
 */
export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV || 'development') as Environment;

  const config: AppConfig = {
    env,
    llm: {
      apiKey: process.env.LLM_API_KEY || '',
      endpoint: process.env.LLM_ENDPOINT || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || 'gpt-4o',
    },
    n8n: {
      baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
      apiKey: process.env.N8N_API_KEY || '',
    },
    limits: {
      maxRecords: parseInt(process.env.LIMIT_MAX_RECORDS || '1000000', 10),
      maxExportSizeMb: parseInt(process.env.LIMIT_MAX_EXPORT_SIZE_MB || '500', 10),
    },
    timeouts: {
      llmRequestMs: parseInt(
        process.env.TIMEOUT_LLM_MS || String(DEFAULT_TIMEOUTS.WorkflowPlanner),
        10
      ),
      n8nRequestMs: parseInt(process.env.TIMEOUT_N8N_MS || String(DEFAULT_TIMEOUTS.Sandbox), 10),
    },
  };

  // Environment-specific overrides
  if (env === 'production') {
    config.n8n.baseUrl = process.env.N8N_BASE_URL || 'http://n8n-platform:5678';
  } else if (env === 'test') {
    config.llm.apiKey = 'test-key';
    config.n8n.apiKey = 'test-key';
  }

  return config;
}

/**
 * Validates the currently loaded configuration, ensuring required secrets exist.
 * Should be called early during application startup.
 * @throws Error if configuration is invalid.
 */
export function validateConfig(config: AppConfig): void {
  const missing: string[] = [];

  if (config.env !== 'test') {
    if (!config.llm.apiKey) missing.push('LLM_API_KEY');
    if (!config.n8n.apiKey) missing.push('N8N_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Configuration validation failed. Missing required environment variables: ${missing.join(', ')}`
    );
  }

  if (isNaN(config.limits.maxRecords) || config.limits.maxRecords <= 0) {
    throw new Error('LIMIT_MAX_RECORDS must be a positive integer.');
  }

  if (isNaN(config.limits.maxExportSizeMb) || config.limits.maxExportSizeMb <= 0) {
    throw new Error('LIMIT_MAX_EXPORT_SIZE_MB must be a positive integer.');
  }
}

// Singleton export
export const config = loadConfig();
