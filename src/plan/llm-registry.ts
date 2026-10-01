import { GeminiLLMClient } from './gemini-client.js';
import { GroqLLMClient } from './groq-client.js';
import type { LLMClient } from './intake-agent.js';
import type { AppConfig } from '../config/env.js';

export function createLLMClient(config: AppConfig): LLMClient {
  const provider = config.llm.provider.toLowerCase();
  
  if (provider === 'groq') {
    return new GroqLLMClient(config.llm.apiKey, config.llm.model);
  } else if (provider === 'gemini') {
    return new GeminiLLMClient(config.llm.apiKey, config.llm.model);
  }
  
  throw new Error(`Unsupported LLM provider: ${config.llm.provider}`);
}
