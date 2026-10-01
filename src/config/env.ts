import * as dotenv from 'dotenv';
import { DEFAULT_TIMEOUTS } from '../core/config.js';

// Load .env if present
dotenv.config({ quiet: true });

export type Environment = 'development' | 'staging' | 'production' | 'test';

export interface AppConfig {
  env: Environment;

  llm: {
    provider: 'gemini' | 'groq';
    apiKey: string;
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
  
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase() as 'gemini' | 'groq';
  
  let apiKey = '';
  let model = '';
  
  if (provider === 'groq') {
    apiKey = process.env.GROQ_API_KEY || '';
    model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
  } else {
    apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || '';
    model = process.env.GEMINI_MODEL || process.env.LLM_MODEL || 'gemini-3-flash-preview';
  }

  const config: AppConfig = {
    env,
    llm: { provider, apiKey, model },
    n8n: {
      baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
      apiKey: process.env.N8N_API_KEY || '',
    },
    limits: {
      maxRecords: Number(process.env.LIMIT_MAX_RECORDS || '1000000'),
      maxExportSizeMb: Number(process.env.LIMIT_MAX_EXPORT_SIZE_MB || '500'),
    },
    timeouts: {
      llmRequestMs: Number(process.env.TIMEOUT_LLM_MS || String(DEFAULT_TIMEOUTS.WorkflowPlanner)),
      n8nRequestMs: Number(process.env.TIMEOUT_N8N_MS || String(DEFAULT_TIMEOUTS.Sandbox)),
    },
  };

  return config;
}

/**
 * Validates the currently loaded configuration, ensuring required secrets exist.
 * Should be called early during application startup.
 * @throws Error if configuration is invalid.
 */
export function validateConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!['development', 'staging', 'production', 'test'].includes(config.env)) throw new Error('Invalid NODE_ENV');
  if (!['gemini', 'groq'].includes(config.llm.provider)) throw new Error('Invalid LLM_PROVIDER');
  
  for (const timeout of Object.values(config.timeouts)) {
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('Timeouts must be positive integers');
  }
  const url = new URL(config.n8n.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid N8N_BASE_URL');

  if (config.env !== 'test') {
    if (!config.llm.apiKey) {
      missing.push(config.llm.provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY');
    }
    if (!config.n8n.apiKey) missing.push('N8N_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Configuration validation failed. Missing required environment variables: ${missing.join(', ')}`
    );
  }

  if (config.llm.provider === 'gemini' && !/^gemini-3[.\w-]*$/.test(config.llm.model)) {
    throw new Error('GEMINI_MODEL must be a Gemini 3 model ID.');
  }

  if (!Number.isSafeInteger(config.limits.maxRecords) || config.limits.maxRecords <= 0) {
    throw new Error('LIMIT_MAX_RECORDS must be a positive integer.');
  }

  if (!Number.isSafeInteger(config.limits.maxExportSizeMb) || config.limits.maxExportSizeMb <= 0) {
    throw new Error('LIMIT_MAX_EXPORT_SIZE_MB must be a positive integer.');
  }
}

// Singleton export
export const config = loadConfig();
