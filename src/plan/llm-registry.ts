import { GeminiLLMClient } from './gemini-client.js';
import type { LLMClient } from './intake-agent.js';
import type { AppConfig } from '../config/env.js';

/** Gemini is the only runtime provider. Transport admission also covers retries. */
export function createLLMClient(config: AppConfig): LLMClient {
  if (config.llm.provider !== 'gemini') throw new Error('LLM_PROVIDER must be gemini');
  return new GeminiLLMClient(config.llm.apiKey, config.llm.model);
}
