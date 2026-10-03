import { setTimeout as delay } from 'node:timers/promises';
import type { LLMClient } from './intake-agent.js';

export class GroqLLMClient implements LLMClient {
  private readonly apiKey: string;
  public readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    if (!this.apiKey) throw new Error('GROQ_API_KEY is required when using Groq');
    if (!this.modelName) throw new Error('GROQ_MODEL is required when using Groq');
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal,
    options?: { maxOutputTokens?: number }
  ): Promise<string> {
    signal.throwIfAborted();
    let response!: Response;
    let retriedJson = false;
    for (let attempt = 0; attempt < 3; attempt++) {
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
      if ((response.status < 500 && response.status !== 429) || attempt === 2) break;
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await delay(
        response.status === 429
          ? Math.min(
              60000,
              Math.max(1000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 15000)
            )
          : 1000 * 2 ** attempt,
        undefined,
        { signal }
      );
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
  }
}
