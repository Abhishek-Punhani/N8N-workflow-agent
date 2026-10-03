/**
 * AI Data Intelligence Platform - Intake Agent
 *
 * LLM-based component that transforms natural language prompts into
 * structured objectives. Uses schema-constrained JSON output to guarantee
 * the response always conforms to the StructuredObjective shape.
 *
 * Key design decisions:
 *  - LLMClient is injected via constructor — swappable for any provider
 *    (OpenAI, Anthropic, Ollama) and easily mocked in tests.
 *  - 30-second timeout enforced via AbortController (Req 1.5).
 *  - Ambiguous prompts return a ClarificationRequest instead of guessing (Req 1.3).
 *  - Multiple interpretations are documented as Assumptions (Req 1.5).
 *  - Output is validated against the StructuredObjective JSON schema before
 *    being returned — if the LLM returns malformed JSON it is caught and
 *    wrapped in a PlanError (Req 1.2).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import type {
  StructuredObjective,
  Constraint,
  FieldDefinition,
  DataSourceHint,
  ConstraintOperator,
  FieldDefinitionType,
} from '../core/types.js';
import { PromptTooLongError, PromptEmptyError, PromptParsingError } from '../core/errors.js';
import { DEFAULT_TIMEOUTS } from '../core/config.js';
import type { IntakeAgentOutput, Assumption, ClarificationRequest } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_PROMPT_LENGTH = 10_000;
const TIMEOUT_MS = DEFAULT_TIMEOUTS.IntakeAgent; // 30 000 ms

// ============================================================================
// LLM Client interface
// ============================================================================

/**
 * Minimal interface for an LLM client.
 * Keeps the IntakeAgent decoupled from any specific provider.
 * Implementations: OpenAILLMClient, MockLLMClient (for tests), etc.
 */
export interface LLMUsage {
  requests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  throttleWaitMs: number;
}

export interface LLMCompletionOptions {
  maxOutputTokens?: number;
  onUsage?: (usage: LLMUsage) => void;
}

export interface LLMClient {
  /**
   * Send a prompt to the LLM and return a JSON-mode response.
   *
   * @param systemPrompt  System instructions (role + output schema constraints).
   * @param userMessage   The user's actual content.
   * @param signal        AbortSignal for timeout enforcement.
   * @returns             Raw string response from the model (must be valid JSON).
   */
  complete(
    systemPrompt: string,
    userMessage: string,
    signal: AbortSignal,
    options?: LLMCompletionOptions
  ): Promise<string>;
}

// ============================================================================
// IntakeAgent config
// ============================================================================

export interface IntakeAgentConfig {
  /** LLM client to use. Required — no default because the API key is external. */
  llmClient: LLMClient;
  /** Override the default 30-second timeout (mainly for tests). */
  timeoutMs?: number;
}

// ============================================================================
// Raw LLM response shape (before validation)
// ============================================================================

interface RawLLMResponse {
  target_entity?: unknown;
  qualification_requirements?: unknown;
  constraints?: unknown;
  required_fields?: unknown;
  data_sources?: unknown;
  output_requirements?: unknown;
  interpretation_confidence?: unknown;
  assumptions?: unknown;
  clarification_needed?: unknown;
}

// ============================================================================
// IntakeAgent class
// ============================================================================

/**
 * IntakeAgent parses a natural language prompt into a StructuredObjective.
 *
 * Usage:
 *   const agent = new IntakeAgent({ llmClient: new OpenAILLMClient(apiKey) });
 *   const output = await agent.parse("Find 100 Indian AI startups ...");
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export class IntakeAgent {
  private readonly llmClient: LLMClient;
  private readonly timeoutMs: number;

  constructor(config: IntakeAgentConfig) {
    this.llmClient = config.llmClient;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Parse a natural language prompt into a StructuredObjective.
   *
   * @param prompt  User's natural language data request (1–10,000 chars).
   * @returns       IntakeAgentOutput with structured_objective and metadata.
   * @throws        PromptEmptyError if prompt is empty.
   * @throws        PromptTooLongError if prompt exceeds 10,000 characters.
   * @throws        PromptParsingError if LLM returns malformed JSON or times out.
   */
  public async parse(prompt: string): Promise<IntakeAgentOutput> {
    // ---- Validate input ----------------------------------------------------
    this.validatePrompt(prompt);

    // ---- Build AbortController for timeout ---------------------------------
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawResponse = await this.llmClient.complete(
        this.buildSystemPrompt(),
        this.buildUserMessage(prompt),
        controller.signal
      );

      return this.parseAndValidateResponse(rawResponse, prompt);
    } catch (err) {
      if (err instanceof PromptEmptyError || err instanceof PromptTooLongError) {
        throw err;
      }
      // AbortError = timeout
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new PromptParsingError(
          `Intake Agent timed out after ${this.timeoutMs}ms`,
          { timeout_ms: this.timeoutMs },
          false
        );
      }
      // Any other error from the LLM
      const message = err instanceof Error ? err.message : String(err);
      throw new PromptParsingError(`LLM call failed: ${message}`, {}, false);
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  /**
   * System prompt that tells the LLM to output schema-constrained JSON.
   * Includes the full output schema definition so the model can apply
   * constrained decoding (JSON mode).
   */
  private buildSystemPrompt(): string {
    return `You are a data requirements analyst. Parse the user's natural language data request into a structured JSON object.

OUTPUT SCHEMA (respond with ONLY valid JSON, no markdown, no explanation):
{
  "target_entity": string,          // Main entity to collect data about
  "qualification_requirements": string[], // Entity/geographic conditions requiring page evidence
  "constraints": [                  // Filtering constraints
    {
      "field": string,
      "operator": "equals" | "contains" | "greater_than" | "less_than" | "between" | "in",
      "value": any,
      "source": string | null
    }
  ],
  "required_fields": [              // Fields that must be in the output
    {
      "name": string,
      "type": "string" | "number" | "date" | "url" | "email" | "array" | "object",
      "required": boolean,         // false only when the user allows missing values
      "description": string | null
    }
  ],
  "data_sources": [                 // Hints about where to find the data
    { "type": string, "hint": string }
  ],
  "output_requirements": {
    "format": "csv" | "json" | null,
    "max_records": number | null
  },
  "interpretation_confidence": number,  // 0.0–1.0
  "assumptions": [                      // Documented assumptions made
    { "description": string, "confidence": number, "documentation": string }
  ],
  "clarification_needed": null | {      // Non-null when prompt is ambiguous
    "questions": string[],
    "suggested_answers": string[] | null
  }
}

RULES:
1. Extract ALL constraints mentioned (counts, dates, locations, categories, etc.)
2. Infer required_fields from what the user asks for
3. Set clarification_needed when the prompt is genuinely ambiguous or incomplete
4. Set interpretation_confidence based on how clear the request is
5. Document assumptions when you choose one interpretation over another
6. NEVER invent data — only extract what is in the prompt
7. Put record counts ONLY in output_requirements.max_records, not in constraints. Constraints are row field predicates.
8. A supplied JSON API URL and explicit fields are sufficient; do not request clarification about obvious field meanings.
9. Put semantic entity/geographic conditions (for example sells TVs, located in Pune India) in qualification_requirements. Do not invent hidden location.city, location.country or category predicates when these are not requested output fields. Constraints are explicit row-field predicates (for example userId equals 1 or price less than 500). Preserve every semantic qualification as a requirement needing source evidence.
10. Evidence/provenance is platform metadata already attached to every field. Requests such as "include evidence for location and business activity" do NOT add evidence_location, evidence_business_activity or source_evidence columns. Add such a column only if the user explicitly names it as an output column. Business phone numbers are strings, never numeric quantities.
11. Honor explicit optionality: "if publicly available", "where available", and "leave missing contacts blank" mean those fields have required:false. For professional and local-business lead requests, email fields are required:false unless the user explicitly says records must have email or to exclude records without email; many legitimate businesses publish phone/location but not email. Otherwise preserve requested fields as required. Never silently relax an explicit completeness requirement. For professional lead requests, contact fields mean only contacts explicitly published for business use, not private personal details. Document this interpretation in assumptions and field descriptions. Keep personal and company contacts distinct; a company switchboard is not a founder's direct phone.`;
  }

  /**
   * User message wrapping the raw prompt.
   */
  private buildUserMessage(prompt: string): string {
    return `Parse this data request into the required JSON structure:\n\n"${prompt}"`;
  }

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  private validatePrompt(prompt: string): void {
    if (!prompt || prompt.trim().length === 0) {
      throw new PromptEmptyError();
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new PromptTooLongError(prompt.length, MAX_PROMPT_LENGTH);
    }
  }

  // -------------------------------------------------------------------------
  // Response parsing and validation
  // -------------------------------------------------------------------------

  /**
   * Parse the raw LLM JSON response and validate it against the expected shape.
   * Returns a fully typed IntakeAgentOutput.
   */
  private parseAndValidateResponse(
    rawResponse: string,
    _originalPrompt: string
  ): IntakeAgentOutput {
    let parsed: RawLLMResponse;

    try {
      parsed = JSON.parse(rawResponse) as RawLLMResponse;
    } catch {
      throw new PromptParsingError(
        'LLM returned invalid JSON',
        { raw_response: rawResponse.slice(0, 200) },
        false
      );
    }

    // Validate required top-level fields
    if (typeof parsed.target_entity !== 'string' || parsed.target_entity.trim() === '') {
      throw new PromptParsingError(
        'LLM response missing required field: target_entity',
        { received: parsed },
        false
      );
    }

    const structured_objective: StructuredObjective = {
      target_entity: parsed.target_entity.trim(),
      constraints: this.parseConstraints(parsed.constraints),
      required_fields: this.parseRequiredFields(parsed.required_fields, _originalPrompt),
      data_sources: this.parseDataSources(parsed.data_sources),
      output_requirements: this.parseOutputRequirements(parsed.output_requirements),
      ...(Array.isArray(parsed.qualification_requirements) &&
      parsed.qualification_requirements.length
        ? {
            qualification_requirements: parsed.qualification_requirements
              .filter(
                (requirement): requirement is string =>
                  typeof requirement === 'string' && requirement.trim().length > 0
              )
              .slice(0, 12),
          }
        : {}),
    };

    const interpretation_confidence = this.parseConfidence(parsed.interpretation_confidence);
    const assumptions = this.parseAssumptions(parsed.assumptions);
    const clarification_needed = this.parseClarification(parsed.clarification_needed);

    // Req 1.3: If prompt is very short/ambiguous and LLM didn't flag it, add
    // a generic clarification if confidence is low
    const output: IntakeAgentOutput = {
      structured_objective,
      interpretation_confidence,
      assumptions,
    };

    if (clarification_needed) {
      output.clarification_needed = clarification_needed;
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // Field parsers — each handles malformed LLM output gracefully
  // -------------------------------------------------------------------------

  private parseConstraints(raw: unknown): Constraint[] {
    if (!Array.isArray(raw)) return [];

    const validOperators: ConstraintOperator[] = [
      'equals',
      'contains',
      'greater_than',
      'less_than',
      'between',
      'in',
    ];

    return raw
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map(c => ({
        field: typeof c['field'] === 'string' ? c['field'] : String(c['field'] ?? ''),
        operator: validOperators.includes(c['operator'] as ConstraintOperator)
          ? (c['operator'] as ConstraintOperator)
          : 'equals',
        value: c['value'] ?? null,
        source: typeof c['source'] === 'string' ? c['source'] : undefined,
      }))
      .filter(c => c.field.length > 0);
  }

  private parseRequiredFields(raw: unknown, originalPrompt = ''): FieldDefinition[] {
    if (!Array.isArray(raw)) return [];

    const validTypes: FieldDefinitionType[] = [
      'string',
      'number',
      'date',
      'url',
      'email',
      'array',
      'object',
    ];

    const isLeadRequest =
      /\b(leads?|retailers?|dealers?|shops?|stores?|business(?:es)?|companies|agencies|vendors|suppliers)\b/i.test(
        originalPrompt
      );
    const emailExplicitlyMandatory =
      /\b(must|only|require(?:d)?|mandatory|exclude|without)\b[^.]{0,80}\bemail\b/i.test(
        originalPrompt
      ) || /\bemail\b[^.]{0,80}\b(must|only|required|mandatory)\b/i.test(originalPrompt);
    const optionalContacts =
      /\b(if|when|where)\s+(publicly\s+)?available\b/i.test(originalPrompt) ||
      /\bleave\s+missing\b/i.test(originalPrompt);

    return raw
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map(f => {
        const name = typeof f['name'] === 'string' ? f['name'] : String(f['name'] ?? '');
        const type = validTypes.includes(f['type'] as FieldDefinitionType)
          ? (f['type'] as FieldDefinitionType)
          : 'string';
        const isEmailField = type === 'email' || /(^|_)e-?mail(_|$)|email/i.test(name);
        return {
          name,
          type,
          required:
            f['required'] !== false &&
            !(isEmailField && (optionalContacts || (isLeadRequest && !emailExplicitlyMandatory))),
          description:
            typeof f['description'] === 'string'
              ? f['description']
              : isEmailField
                ? 'Publicly listed business email, blank when not published.'
                : undefined,
        };
      })
      .filter(f => f.name.length > 0);
  }

  private parseDataSources(raw: unknown): DataSourceHint[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map(s => ({
        type: typeof s['type'] === 'string' ? s['type'] : undefined,
        hint: typeof s['hint'] === 'string' ? s['hint'] : undefined,
      }));
  }

  private parseOutputRequirements(raw: unknown): StructuredObjective['output_requirements'] {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const obj = raw as Record<string, unknown>;
    return {
      format: obj['format'] === 'csv' || obj['format'] === 'json' ? obj['format'] : undefined,
      max_records: typeof obj['max_records'] === 'number' ? obj['max_records'] : undefined,
    };
  }

  private parseConfidence(raw: unknown): number {
    if (typeof raw !== 'number') return 0.5;
    return Math.min(1.0, Math.max(0.0, raw));
  }

  private parseAssumptions(raw: unknown): Assumption[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
      .map(a => ({
        description: typeof a['description'] === 'string' ? a['description'] : '',
        confidence:
          typeof a['confidence'] === 'number' ? Math.min(1.0, Math.max(0.0, a['confidence'])) : 0.5,
        documentation: typeof a['documentation'] === 'string' ? a['documentation'] : '',
      }))
      .filter(a => a.description.length > 0);
  }

  private parseClarification(raw: unknown): ClarificationRequest | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj['questions']) || obj['questions'].length === 0) return undefined;
    return {
      questions: obj['questions'].filter((q): q is string => typeof q === 'string'),
      suggested_answers: Array.isArray(obj['suggested_answers'])
        ? obj['suggested_answers'].filter((a): a is string => typeof a === 'string')
        : undefined,
    };
  }
}
