import { GeminiLLMClient } from './gemini-client.js';
import { GroqLLMClient } from './groq-client.js';
import { RateLimitedLLMClient } from './rate-limiter.js';
import type { LLMClient } from './intake-agent.js';
import type { AppConfig } from '../config/env.js';

function createProviderClient(config: AppConfig): LLMClient {
  const provider = config.llm.provider.toLowerCase();

  if (provider === 'groq') {
    return new GroqLLMClient(config.llm.apiKey, config.llm.model);
  } else if (provider === 'gemini') {
    return new GeminiLLMClient(config.llm.apiKey, config.llm.model);
  }

  throw new Error(`Unsupported LLM provider: ${config.llm.provider}`);
}

/** Every model call goes through here, so pacing applies to all providers and callers. */
export function createLLMClient(config: AppConfig): LLMClient {
  const rpm = Number(process.env.LLM_MAX_RPM ?? '10');
  return new RateLimitedLLMClient(createProviderClient(config), Number.isFinite(rpm) ? rpm : 10);
}
