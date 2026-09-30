/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
/**
 * AI Data Intelligence Platform - Gemini LLM Client
 *
 * Implements the LLMClient interface using Google's Gemini API.
 * Reads GEMINI_API_KEY (and optionally GEMINI_MODEL) from environment
 * variables loaded via dotenv.
 *
 * Usage:
 *   import { GeminiLLMClient } from './gemini-client.js';
 *   import { IntakeAgent } from './intake-agent.js';
 *
 *   const agent = new IntakeAgent({ llmClient: new GeminiLLMClient() });
 *   const output = await agent.parse("Find 100 Indian AI startups...");
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import 'dotenv/config';
import type { LLMClient } from './intake-agent.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL = 'gemini-1.5-flash';

// ============================================================================
// GeminiLLMClient
// ============================================================================

export class GeminiLLMClient implements LLMClient {
  private readonly model: GenerativeModel;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey ?? process.env['GEMINI_API_KEY'];
    if (!key || key === 'your_gemini_api_key_here') {
      throw new Error(
        'GEMINI_API_KEY is not set. Add it to your .env file.\n' +
          'Get a free key at: https://aistudio.google.com/app/apikey'
      );
    }

    const model = modelName ?? process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL;
    const genAI = new GoogleGenerativeAI(key);

    this.model = genAI.getGenerativeModel({
      model,
      generationConfig: {
        // JSON mode — Gemini returns pure JSON when responseMimeType is set
        responseMimeType: 'application/json',
        temperature: 0.2, // Low temperature for deterministic structured output
        topP: 0.8,
        maxOutputTokens: 2048,
      },
    });
  }

  /**
   * Send system + user messages to Gemini and return the raw JSON string.
   * Respects the AbortSignal so the IntakeAgent's 30s timeout is enforced.
   */
  public async complete(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal
  ): Promise<string> {
    // Gemini doesn't have a native system-role message in the basic SDK;
    // we prepend the system prompt as the first turn in the conversation.
    const prompt = `${systemPrompt}\n\n${userMessage}`;

    // Wrap in an AbortSignal-aware race
    const generatePromise = this.model.generateContent(prompt);

    const result = await Promise.race([
      generatePromise,
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
        );
      }),
    ]);

    const text = result.response.text();
    return text.trim();
  }
}
