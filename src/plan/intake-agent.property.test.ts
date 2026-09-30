/**
 * AI Data Intelligence Platform - IntakeAgent Property-Based Tests
 *
 * Task 4.2 — Property 1: Output Schema Compliance
 *
 * Uses fast-check (100+ iterations) and mocked LLM responses to verify
 * that IntakeAgent.parse() ALWAYS returns a structured_objective that
 * conforms to the StructuredObjective JSON schema, regardless of:
 *   - What prompt text is given
 *   - What fields the LLM chooses to populate
 *   - What constraint operators / field types appear in the response
 *   - Whether clarification is needed or not
 *
 * Validates: Requirement 1.2
 */

import * as fc from 'fast-check';
import { IntakeAgent } from './intake-agent.js';
import type { LLMClient } from './intake-agent.js';
import type { ConstraintOperator, FieldDefinitionType } from '../core/types.js';
import { StructuredObjectiveSchema } from '../core/schemas.js';

// ============================================================================
// JSON Schema validator (lightweight, no external dep needed)
// ============================================================================

/**
 * Validates a value against the StructuredObjectiveSchema without pulling in
 * a full JSON Schema library — we implement just the subset we need.
 *
 * Returns an array of validation errors (empty = valid).
 */
function validateStructuredObjective(obj: unknown): string[] {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    errors.push('structured_objective must be a non-null object');
    return errors;
  }

  const o = obj as Record<string, unknown>;

  // Required: target_entity (string)
  if (typeof o['target_entity'] !== 'string' || o['target_entity'].trim() === '') {
    errors.push('target_entity must be a non-empty string');
  }

  // Required: constraints (array)
  if (!Array.isArray(o['constraints'])) {
    errors.push('constraints must be an array');
  } else {
    const validOps = new Set<string>([
      'equals',
      'contains',
      'greater_than',
      'less_than',
      'between',
      'in',
    ]);
    (o['constraints'] as unknown[]).forEach((c, i) => {
      if (typeof c !== 'object' || c === null) {
        errors.push(`constraints[${i}] must be an object`);
        return;
      }
      const constraint = c as Record<string, unknown>;
      if (typeof constraint['field'] !== 'string')
        errors.push(`constraints[${i}].field must be a string`);
      if (!validOps.has(constraint['operator'] as string))
        errors.push(`constraints[${i}].operator must be a valid ConstraintOperator`);
    });
  }

  // Required: required_fields (array)
  if (!Array.isArray(o['required_fields'])) {
    errors.push('required_fields must be an array');
  } else {
    const validTypes = new Set<string>([
      'string',
      'number',
      'date',
      'url',
      'email',
      'array',
      'object',
    ]);
    (o['required_fields'] as unknown[]).forEach((f, i) => {
      if (typeof f !== 'object' || f === null) {
        errors.push(`required_fields[${i}] must be an object`);
        return;
      }
      const field = f as Record<string, unknown>;
      if (typeof field['name'] !== 'string' || field['name'].trim() === '')
        errors.push(`required_fields[${i}].name must be a non-empty string`);
      if (!validTypes.has(field['type'] as string))
        errors.push(`required_fields[${i}].type must be a valid FieldDefinitionType`);
      if (typeof field['required'] !== 'boolean')
        errors.push(`required_fields[${i}].required must be a boolean`);
    });
  }

  // Optional: data_sources (array if present)
  if (o['data_sources'] !== undefined && !Array.isArray(o['data_sources'])) {
    errors.push('data_sources must be an array when present');
  }

  // Optional: output_requirements (object if present)
  if (o['output_requirements'] !== undefined) {
    if (typeof o['output_requirements'] !== 'object' || o['output_requirements'] === null) {
      errors.push('output_requirements must be an object when present');
    } else {
      const or = o['output_requirements'] as Record<string, unknown>;
      if (or['format'] !== undefined && or['format'] !== 'csv' && or['format'] !== 'json') {
        errors.push('output_requirements.format must be "csv" or "json"');
      }
      if (or['max_records'] !== undefined && typeof or['max_records'] !== 'number') {
        errors.push('output_requirements.max_records must be a number');
      }
    }
  }

  return errors;
}

// ============================================================================
// Arbitraries for LLM response generation
// ============================================================================

const arbOperator: fc.Arbitrary<ConstraintOperator> = fc.constantFrom(
  'equals',
  'contains',
  'greater_than',
  'less_than',
  'between',
  'in'
);

const arbFieldType: fc.Arbitrary<FieldDefinitionType> = fc.constantFrom(
  'string',
  'number',
  'date',
  'url',
  'email',
  'array',
  'object'
);

const arbConstraint = fc.record({
  field: fc.string({ minLength: 1, maxLength: 20 }),
  operator: arbOperator,
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  source: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
});

const arbFieldDef = fc.record({
  name: fc.stringMatching(/^[a-z][a-z_]{0,19}$/),
  type: arbFieldType,
  required: fc.boolean(),
  description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const arbDataSource = fc.record({
  type: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  hint: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
});

const arbOutputRequirements = fc.option(
  fc.record({
    format: fc.option(fc.constantFrom('csv', 'json') as fc.Arbitrary<'csv' | 'json'>, {
      nil: undefined,
    }),
    max_records: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: undefined }),
  }),
  { nil: undefined }
);

/** Generate a complete valid LLM JSON response string. */
const arbLLMResponse = fc
  .record({
    target_entity: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    constraints: fc.array(arbConstraint, { maxLength: 5 }),
    required_fields: fc.array(arbFieldDef, { maxLength: 8 }),
    data_sources: fc.array(arbDataSource, { maxLength: 4 }),
    output_requirements: arbOutputRequirements,
    interpretation_confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    assumptions: fc.array(
      fc.record({
        description: fc.string({ minLength: 1, maxLength: 60 }),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
        documentation: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      { maxLength: 3 }
    ),
    clarification_needed: fc.option(
      fc.record({
        questions: fc.array(fc.string({ minLength: 5, maxLength: 60 }), {
          minLength: 1,
          maxLength: 3,
        }),
        suggested_answers: fc.option(fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }), {
          nil: undefined,
        }),
      }),
      { nil: null }
    ),
  })
  .map(obj => JSON.stringify(obj));

/** A mock LLM client that returns a pre-set JSON string. */
function makeMockClient(response: string): LLMClient {
  return {
    complete: async (_sys, _user, _signal) => response,
  };
}

/** A valid non-empty prompt string that is guaranteed non-whitespace. */
const arbPrompt = fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0);

// ============================================================================
// Property 1: Output Schema Compliance
//
// "Verify StructuredObjective conforms to JSON schema"
//
// For any valid LLM JSON response, IntakeAgent.parse() must return a
// structured_objective that:
//  1a. Is a non-null object with all required fields (target_entity,
//      constraints, required_fields)
//  1b. constraints[] each have a valid operator from the closed set
//  1c. required_fields[] each have a valid type from the closed set
//  1d. optional fields (data_sources, output_requirements) are correctly
//      typed when present
//  1e. interpretation_confidence is in [0.0, 1.0]
//  1f. The result never throws for valid LLM responses
//
// Validates: Requirement 1.2
// ============================================================================

describe('Property 1: Output Schema Compliance', () => {
  it('structured_objective always conforms to StructuredObjectiveSchema for any valid LLM response', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);

        const errors = validateStructuredObjective(output.structured_objective);
        expect(errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('target_entity is always a non-empty string', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);

        expect(typeof output.structured_objective.target_entity).toBe('string');
        expect(output.structured_objective.target_entity.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('constraints[] is always an array with valid operators', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);
        const { constraints } = output.structured_objective;

        expect(Array.isArray(constraints)).toBe(true);

        const validOps: ConstraintOperator[] = [
          'equals',
          'contains',
          'greater_than',
          'less_than',
          'between',
          'in',
        ];
        for (const c of constraints) {
          expect(validOps).toContain(c.operator);
          expect(typeof c.field).toBe('string');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('required_fields[] is always an array with valid types', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);
        const { required_fields } = output.structured_objective;

        expect(Array.isArray(required_fields)).toBe(true);

        const validTypes: FieldDefinitionType[] = [
          'string',
          'number',
          'date',
          'url',
          'email',
          'array',
          'object',
        ];
        for (const f of required_fields) {
          expect(validTypes).toContain(f.type);
          expect(typeof f.name).toBe('string');
          expect(f.name.trim().length).toBeGreaterThan(0);
          expect(typeof f.required).toBe('boolean');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('interpretation_confidence is always in [0.0, 1.0]', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);

        expect(output.interpretation_confidence).toBeGreaterThanOrEqual(0.0);
        expect(output.interpretation_confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 }
    );
  });

  it('assumptions[] is always an array (never undefined)', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);

        expect(Array.isArray(output.assumptions)).toBe(true);

        for (const a of output.assumptions) {
          expect(typeof a.description).toBe('string');
          expect(a.confidence).toBeGreaterThanOrEqual(0.0);
          expect(a.confidence).toBeLessThanOrEqual(1.0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('clarification_needed is either undefined or a well-formed ClarificationRequest', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        const output = await agent.parse(prompt);

        if (output.clarification_needed !== undefined) {
          expect(Array.isArray(output.clarification_needed.questions)).toBe(true);
          expect(output.clarification_needed.questions.length).toBeGreaterThan(0);
          for (const q of output.clarification_needed.questions) {
            expect(typeof q).toBe('string');
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never throws for any valid LLM JSON response', () => {
    fc.assert(
      fc.asyncProperty(arbPrompt, arbLLMResponse, async (prompt, llmResponse) => {
        const agent = new IntakeAgent({ llmClient: makeMockClient(llmResponse), timeoutMs: 5000 });
        await expect(agent.parse(prompt)).resolves.toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  it('StructuredObjectiveSchema defines the required fields we are validating against', () => {
    // Confirm the schema itself has the expected required fields — so our
    // property test is actually testing the right contract
    expect(StructuredObjectiveSchema.required).toContain('target_entity');
    expect(StructuredObjectiveSchema.required).toContain('constraints');
    expect(StructuredObjectiveSchema.required).toContain('required_fields');
  });
});

// ============================================================================
// Edge cases — malformed LLM responses are handled gracefully
// ============================================================================

describe('Property 1 edge cases: malformed LLM output', () => {
  const validPrompt = 'Find 100 Indian AI startups';

  it('throws PromptParsingError when LLM returns non-JSON', async () => {
    const agent = new IntakeAgent({
      llmClient: makeMockClient('This is not JSON at all'),
      timeoutMs: 5000,
    });
    await expect(agent.parse(validPrompt)).rejects.toThrow('invalid JSON');
  });

  it('throws PromptParsingError when LLM returns JSON missing target_entity', async () => {
    const agent = new IntakeAgent({
      llmClient: makeMockClient(JSON.stringify({ constraints: [], required_fields: [] })),
      timeoutMs: 5000,
    });
    await expect(agent.parse(validPrompt)).rejects.toThrow();
  });

  it('tolerates missing optional arrays by defaulting to []', async () => {
    const agent = new IntakeAgent({
      llmClient: makeMockClient(
        JSON.stringify({
          target_entity: 'AI startups',
          // constraints and required_fields omitted
          interpretation_confidence: 0.9,
          assumptions: [],
          clarification_needed: null,
        })
      ),
      timeoutMs: 5000,
    });
    const output = await agent.parse(validPrompt);
    expect(output.structured_objective.constraints).toEqual([]);
    expect(output.structured_objective.required_fields).toEqual([]);
  });

  it('throws PromptEmptyError for empty prompt', async () => {
    const agent = new IntakeAgent({
      llmClient: makeMockClient('{}'),
      timeoutMs: 5000,
    });
    await expect(agent.parse('')).rejects.toThrow('empty');
  });

  it('throws PromptTooLongError for prompt over 10000 chars', async () => {
    const agent = new IntakeAgent({
      llmClient: makeMockClient('{}'),
      timeoutMs: 5000,
    });
    await expect(agent.parse('a'.repeat(10001))).rejects.toThrow('exceeds maximum length');
  });
});
