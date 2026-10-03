import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import type { LLMClient, LLMCompletionOptions, LLMUsage } from './intake-agent.js';
import { rateLimitFromEnv, sharedRateLimiter, RequestRateLimiter } from './rate-limiter.js';

const THINKING_HEADROOM_TOKENS = 8192;
interface GeminiBody {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: {
    details?: Array<{
      retryDelay?: string;
      violations?: Array<{ quotaMetric?: string; quotaId?: string; quotaValue?: string }>;
    }>;
  };
}

function retryDelay(response: Response, body: GeminiBody, attempt: number): number {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  const headerMs = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : header
      ? Math.max(0, Date.parse(header) - Date.now())
      : 0;
  const serverMs = Math.max(
    0,
    ...(body.error?.details ?? []).map(detail =>
      /^\d+(?:\.\d+)?s$/.test(detail.retryDelay ?? '')
        ? Number(detail.retryDelay!.slice(0, -1)) * 1000
        : 0
    )
  );
  // Never shorten provider cooldowns. Jitter prevents synchronized retry bursts.
  return Math.max(headerMs || 0, serverMs, 4000 * 2 ** attempt + Math.random() * 1000);
}

function exhaustedDailyQuota(body: GeminiBody): boolean {
  return (body.error?.details ?? []).some(detail =>
    detail.violations?.some(
      violation =>
        /per.?day|daily/i.test((violation.quotaMetric ?? '') + ' ' + (violation.quotaId ?? '')) ||
        violation.quotaValue === '0'
    )
  );
}

/** Single runtime provider, with shared admission on every HTTP attempt. */
export class GeminiLLMClient implements LLMClient {
  private readonly apiKey: string;
  public readonly modelName: string;
  private readonly limiter: RequestRateLimiter;

  constructor(apiKey?: string, modelName?: string, limiter?: RequestRateLimiter) {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? '';
    this.modelName =
      modelName ?? process.env.GEMINI_MODEL ?? process.env.LLM_MODEL ?? 'gemini-3-flash-preview';
    if (!this.apiKey) throw new Error('GEMINI_API_KEY (or LLM_API_KEY) is required');
    if (!/^gemini-3[.\w-]*$/.test(this.modelName))
      throw new Error('A Gemini 3 model ID is required');
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
    const usage: LLMUsage = {
      requests: 0,
      retries: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      throttleWaitMs: 0,
    };
    // Estimate text input locally, then reconcile against Gemini usage. This avoids
    // adding countTokens calls. Estimates cannot guarantee the provider's TPM quota.
    const estimatedInput =
      Math.ceil(Buffer.byteLength(systemPrompt + userMessage, 'utf8') / 3) + 32;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const reservation = await this.limiter.acquire(estimatedInput, signal);
        usage.throttleWaitMs += reservation.waitMs;
        usage.requests++;
        if (attempt) usage.retries++;
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(this.modelName) +
            ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: userMessage }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 1,
                // Thinking and visible output share this cap. Headroom is a ceiling,
                // not tokens charged in advance; retain it to avoid truncated JSON.
                maxOutputTokens: (options?.maxOutputTokens ?? 16384) + THINKING_HEADROOM_TOKENS,
                thinkingConfig: { thinkingLevel: 'low' },
              },
            }),
          }
        );
        let body: GeminiBody = {};
        try {
          body = (await response.json()) as GeminiBody;
        } catch {
          if (response.ok) throw new Error('Gemini returned invalid JSON');
        }
        const tokenCount = (value: number | undefined) =>
          Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
        const input = tokenCount(body.usageMetadata?.promptTokenCount);
        usage.inputTokens += input;
        usage.outputTokens += tokenCount(body.usageMetadata?.candidatesTokenCount);
        usage.thinkingTokens += tokenCount(body.usageMetadata?.thoughtsTokenCount);
        this.limiter.reconcile(reservation, input);
        if (!response.ok) {
          const daily = response.status === 429 && exhaustedDailyQuota(body);
          const retryable = !daily && (response.status === 429 || response.status >= 500);
          const waitMs = retryable ? retryDelay(response, body, attempt) : 0;
          if (response.status === 429 && retryable) this.limiter.cooldown(waitMs);
          if (!retryable || attempt === 2)
            // Never echo upstream error text: it may contain prompts or credentials.
            throw new Error(
              'Gemini request failed (HTTP ' +
                response.status +
                ', model ' +
                this.modelName +
                ')' +
                (daily ? '; daily or zero quota exhausted' : '')
            );
          if (response.status !== 429) {
            const waitingAt = Date.now();
            await delay(waitMs, undefined, { signal });
            usage.throttleWaitMs += Date.now() - waitingAt;
          }
          continue;
        }
        const candidate = body.candidates?.[0];
        if (candidate?.finishReason !== 'STOP')
          throw new Error(
            'Gemini did not complete: ' + (candidate?.finishReason ?? 'no candidate')
          );
        const text = candidate.content?.parts
          ?.filter(part => !part.thought)
          .map(part => part.text ?? '')
          .join('')
          .trim();
        if (!text) throw new Error('Gemini returned an empty response');
        JSON.parse(text);
        return text;
      }
      throw new Error('Gemini retry budget exhausted');
    } finally {
      options?.onUsage?.(usage);
    }
  }
}
