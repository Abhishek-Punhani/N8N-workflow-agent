import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import type { LLMClient } from './intake-agent.js';

/** Single provider for every planning and repair call. No provider/model fallback. */
export class GeminiLLMClient implements LLMClient {
  private readonly apiKey: string;
  public readonly modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.LLM_API_KEY ?? '';
    this.modelName = modelName ?? process.env.GEMINI_MODEL ?? process.env.LLM_MODEL ?? 'gemini-3.1-pro-preview';
    if (!this.apiKey) throw new Error('GEMINI_API_KEY (or LLM_API_KEY) is required');
    if (!/^gemini-3[.\w-]*$/.test(this.modelName)) throw new Error('A Gemini 3 model ID is required');
  }

  async complete(systemPrompt: string, userMessage: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    let response!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelName)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 1, maxOutputTokens: 16384 },
      }),
    });
    if (response.status < 500 || attempt === 2) break;
    await response.body?.cancel();
    await delay(1000 * 2 ** attempt, undefined, { signal });
    }
    // Do not echo upstream bodies: they may contain request contents or credentials.
    if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}, model ${this.modelName})`);
    const body = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error(`Gemini did not complete: ${candidate?.finishReason ?? 'no candidate'}`);
    const text = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini returned an empty response');
    JSON.parse(text);
    return text;
  }
}
