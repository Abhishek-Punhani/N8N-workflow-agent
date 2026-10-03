import { GeminiLLMClient } from './gemini-client.js';
import { GroqLLMClient } from './groq-client.js';
import type { LLMClient } from './intake-agent.js';
import type { AppConfig } from '../config/env.js';

/** Creates the configured runtime LLM transport. No synthetic fallback is used. */
export function createLLMClient(config: AppConfig): LLMClient {
  if (config.llm.provider === 'groq')
    return new GroqLLMClient(config.llm.apiKey, config.llm.model);
  if (config.llm.provider === 'gemini')
    return new GeminiLLMClient(config.llm.apiKey, config.llm.model);
  throw new Error('LLM_PROVIDER must be gemini or groq');
}
