import { setTimeout as delay } from 'node:timers/promises';
import { rateLimitFromEnv, sharedRateLimiter, RequestRateLimiter } from './rate-limiter.js';
import type { LLMClient, LLMCompletionOptions, LLMUsage } from './intake-agent.js';

interface GroqResponseBody {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: unknown };
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const retrySeconds = retryAfter === null ? NaN : Number(retryAfter);
  const retryAfterMs = Number.isFinite(retrySeconds)
    ? Math.max(0, retrySeconds * 1000)
    : retryAfter
      ? Math.max(0, Date.parse(retryAfter) - Date.now())
      : 0;
  const resetMs = Math.max(
    0,
    ...['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests'].map(header =>
      parseProviderDuration(response.headers.get(header))
    )
  );
  return Math.max(retryAfterMs, resetMs, 5000 * 2 ** attempt + Math.random() * 1000);
}

function parseProviderDuration(value: string | null): number {
  if (!value) return 0;
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.max(0, direct * 1000);
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)];
  if (!parts.length || parts.map(part => part[0]).join('') !== value) return 0;
  return parts.reduce((total, part) => {
    const amount = Number(part[1]);
    const unit = part[2].toLowerCase();
    return (
      total + amount * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1)
    );
  }, 0);
}

export class GroqLLMClient implements LLMClient {
  private readonly apiKey: string;
  public readonly modelName: string;
  private readonly limiter: RequestRateLimiter;

  constructor(apiKey: string, modelName: string, limiter?: RequestRateLimiter) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    if (!this.apiKey) throw new Error('GROQ_API_KEY is required when using Groq');
    if (!this.modelName) throw new Error('GROQ_MODEL is required when using Groq');
    this.limiter =
      limiter ??
      sharedRateLimiter(
        this.modelName,
        rateLimitFromEnv('LLM_MAX_RPM', 10),
        rateLimitFromEnv('LLM_MAX_TPM', 0)
      );
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal,
    options?: LLMCompletionOptions
  ): Promise<string> {
    signal.throwIfAborted();
    let response!: Response;
    let retriedJson = false;
    const usage: LLMUsage = {
      requests: 0,
      retries: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      throttleWaitMs: 0,
    };
    const estimatedInput =
      Math.ceil(Buffer.byteLength(systemPrompt + userMessage, 'utf8') / 3) + 32;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const reservation = await this.limiter.acquire(estimatedInput, signal);
        usage.throttleWaitMs += reservation.waitMs;
        usage.requests++;
        if (attempt) usage.retries++;
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: this.modelName,
            messages: [
              {
                role: 'system',
                content:
                  systemPrompt +
                  (retriedJson
                    ? '\nYour previous response failed JSON validation. Return exactly one valid JSON object using the requested schema. Empty results must be arrays inside that object, never a top-level array. Do not include markdown or explanatory text.'
                    : ''),
              },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.1,
            max_completion_tokens: options?.maxOutputTokens ?? 4000,
            response_format: { type: 'json_object' },
          }),
        });
        if (response.status === 400 && !retriedJson && attempt < 2) {
          const failure = (await response
            .clone()
            .json()
            .catch(() => null)) as { error?: { code?: unknown } } | null;
          if (failure?.error?.code === 'json_validate_failed') {
            retriedJson = true;
            await response.body?.cancel();
            continue;
          }
        }
        const body = response.ok
          ? ((await response
              .clone()
              .json()
              .catch(() => null)) as GroqResponseBody | null)
          : null;
        const inputTokens = body?.usage?.prompt_tokens;
        const outputTokens = body?.usage?.completion_tokens;
        if (Number.isSafeInteger(inputTokens) && inputTokens! >= 0) {
          usage.inputTokens += inputTokens!;
          this.limiter.reconcile(reservation, inputTokens!);
        }
        if (Number.isSafeInteger(outputTokens) && outputTokens! >= 0)
          usage.outputTokens += outputTokens!;
        if ((response.status < 500 && response.status !== 429) || attempt === 2) break;
        const waitMs =
          response.status === 429 ? retryDelay(response, attempt) : 1000 * 2 ** attempt;
        if (response.status === 429) this.limiter.cooldown(waitMs);
        await response.body?.cancel();
        const waitingAt = Date.now();
        await delay(waitMs, undefined, { signal });
        usage.throttleWaitMs += Date.now() - waitingAt;
      }

      if (!response.ok) {
        // Codes are actionable; raw messages/failed generations may echo source or user data.
        const failure = (await response.json().catch(() => null)) as {
          error?: { code?: unknown };
        } | null;
        const code = failure?.error?.code;
        const detail =
          typeof code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? `, code ${code}` : '';
        throw new Error(
          `Groq request failed (HTTP ${response.status}, model ${this.modelName}${detail})`
        );
      }

      const body = (await response.json()) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      };
      const choice = body.choices?.[0];

      if (choice?.finish_reason !== 'stop')
        throw new Error(`Groq did not complete: ${choice?.finish_reason ?? 'no choice'}`);

      const text = choice.message?.content?.trim() ?? '';
      if (!text) throw new Error('Groq returned an empty response');

      // Ensure it parses successfully
      JSON.parse(text);
      return text;
    } finally {
      options?.onUsage?.(usage);
    }
  }
}
