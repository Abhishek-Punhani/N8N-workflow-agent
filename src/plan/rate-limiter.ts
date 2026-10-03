import type { LLMClient } from './intake-agent.js';

/**
 * Process-wide pacing for model calls. Quotas are enforced per minute (requests and
 * tokens), so spacing calls avoids bursts that trigger HTTP 429 regardless of provider.
 * Shared across concurrent jobs because they share one API key.
 */
let nextSlot = 0;

async function waitForSlot(minIntervalMs: number, signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + minIntervalMs;
  const wait = start - now;
  if (wait <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, wait);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class RateLimitedLLMClient implements LLMClient {
  private readonly minIntervalMs: number;

  constructor(
    private readonly inner: LLMClient,
    maxRequestsPerMinute: number
  ) {
    this.minIntervalMs = maxRequestsPerMinute > 0 ? Math.ceil(60_000 / maxRequestsPerMinute) : 0;
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal,
    options?: { maxOutputTokens?: number }
  ): Promise<string> {
    if (this.minIntervalMs > 0) await waitForSlot(this.minIntervalMs, signal);
    return this.inner.complete(systemPrompt, userMessage, signal, options);
  }
}
