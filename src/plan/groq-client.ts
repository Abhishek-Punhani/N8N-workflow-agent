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

  async complete(systemPrompt: string, userMessage: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    let response!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        signal,
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.1,
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' }
        }),
      });
      if (response.status < 500 || attempt === 2) break;
      await response.body?.cancel();
      await delay(1000 * 2 ** attempt, undefined, { signal });
    }
    
    if (!response.ok) throw new Error(`Groq request failed (HTTP ${response.status}, model ${this.modelName})`);
    
    const body = await response.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
    const choice = body.choices?.[0];
    
    if (choice?.finish_reason !== 'stop') throw new Error(`Groq did not complete: ${choice?.finish_reason ?? 'no choice'}`);
    
    const text = choice.message?.content?.trim() ?? '';
    if (!text) throw new Error('Groq returned an empty response');
    
    // Ensure it parses successfully
    JSON.parse(text);
    return text;
  }
}
