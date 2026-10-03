import { setTimeout as delay } from 'node:timers/promises';

const WINDOW_MS = 60_000;
export interface RequestReservation {
  at: number;
  tokens: number;
  waitMs: number;
}

/** FIFO admission shared by transport attempts, including retries and concurrent jobs. */
export class RequestRateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private entries: RequestReservation[] = [];

  constructor(
    private readonly maxRequestsPerMinute: number,
    private readonly maxInputTokensPerMinute = 0
  ) {
    for (const value of [maxRequestsPerMinute, maxInputTokensPerMinute])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('LLM rate limits must be non-negative integers');
  }

  cooldown(waitMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + waitMs);
  }

  reconcile(reservation: RequestReservation, actualInputTokens: number): void {
    reservation.tokens = Math.max(reservation.tokens, actualInputTokens);
  }

  async acquire(inputTokens: number, signal: AbortSignal): Promise<RequestReservation> {
    signal.throwIfAborted();
    if (this.maxInputTokensPerMinute && inputTokens > this.maxInputTokensPerMinute)
      throw new Error(
        'Estimated request input exceeds LLM_MAX_TPM; reduce the request or raise the configured limit'
      );
    const queuedAt = Date.now();
    const operation = this.tail.then(async () => {
      // Cancelled queued requests consume no quota and reserve no future slots.
      for (;;) {
        signal.throwIfAborted();
        const now = Date.now();
        this.entries = this.entries.filter(entry => entry.at > now - WINDOW_MS);
        let allowedAt = Math.max(this.nextRequestAt, this.cooldownUntil);
        if (this.maxRequestsPerMinute && this.entries.length >= this.maxRequestsPerMinute)
          allowedAt = Math.max(allowedAt, this.entries[0].at + WINDOW_MS);
        if (this.maxInputTokensPerMinute) {
          let total = this.entries.reduce((sum, entry) => sum + entry.tokens, 0);
          for (const entry of this.entries) {
            if (total + inputTokens <= this.maxInputTokensPerMinute) break;
            allowedAt = Math.max(allowedAt, entry.at + WINDOW_MS);
            total -= entry.tokens;
          }
        }
        if (allowedAt > now) {
          await delay(allowedAt - now, undefined, { signal });
          continue; // Recheck shared cooldowns and reconciled usage after waiting.
        }
        const reservation = { at: now, tokens: inputTokens, waitMs: now - queuedAt };
        this.entries.push(reservation);
        this.nextRequestAt = this.maxRequestsPerMinute
          ? now + Math.ceil(WINDOW_MS / this.maxRequestsPerMinute)
          : now;
        return reservation;
      }
    });
    this.tail = operation.catch(() => undefined);
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([operation, cancelled]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

const shared = new Map<string, RequestRateLimiter>();

/** One application process normally uses one project; share model quotas across API keys. */
export function sharedRateLimiter(model: string, rpm: number, tpm: number): RequestRateLimiter {
  const key = `${model}:${rpm}:${tpm}`;
  let limiter = shared.get(key);
  if (!limiter) {
    limiter = new RequestRateLimiter(rpm, tpm);
    shared.set(key, limiter);
  }
  return limiter;
}

export function rateLimitFromEnv(name: string, fallback: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
}
