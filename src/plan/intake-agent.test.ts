/**
 * AI Data Intelligence Platform - IntakeAgent Unit Tests (Task 4.3)
 *
 * Tests the IntakeAgent in isolation by injecting a MockLLMClient.
 * No real API calls are made. Covers:
 *  - Empty prompt rejection (Req 1.1)
 *  - Prompt too long rejection (Req 1.1)
 *  - Full constraint extraction — all 6 operators (Req 1.2)
 *  - Clarification request generation for ambiguous prompts (Req 1.3)
 *  - Assumption documentation (Req 1.4)
 *  - Timeout enforcement at 30 s (Req 1.5)
 *  - Malformed JSON from LLM
 *  - Missing target_entity in LLM response
 *  - LLM hard errors
 *  - output_requirements extraction (format + max_records)
 *  - data_sources extraction
 */

import { IntakeAgent, LLMClient } from './intake-agent.js';
import { PromptEmptyError, PromptTooLongError, PromptParsingError } from '../core/errors.js';
import type { IntakeAgentOutput } from './types.js';

// ============================================================================
// Mock LLM Client helpers
// ============================================================================

/**
 * Creates an LLMClient mock that immediately resolves with `response`.
 */
function mockClient(response: string): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue(response),
  };
}

/**
 * Creates an LLMClient mock that rejects with `error`.
 */
function failingClient(error: Error): LLMClient {
  return {
    complete: jest.fn().mockRejectedValue(error),
  };
}

/**
 * Creates an LLMClient mock that never resolves (hangs forever).
 * Used for timeout tests.
 */
function hangingClient(): LLMClient {
  return {
    complete: jest.fn().mockImplementation(
      (_system: string, _user: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
          );
        })
    ),
  };
}

/** Canonical valid LLM JSON response. */
function validResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    target_entity: 'AI startups',
    constraints: [{ field: 'country', operator: 'equals', value: 'India', source: null }],
    required_fields: [
      { name: 'company_name', type: 'string', required: true, description: 'Name of startup' },
      { name: 'funding_usd', type: 'number', required: true, description: null },
    ],
    data_sources: [{ type: 'web', hint: 'Crunchbase, LinkedIn' }],
    output_requirements: { format: 'csv', max_records: 100 },
    interpretation_confidence: 0.9,
    assumptions: [],
    clarification_needed: null,
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('IntakeAgent — Input Validation', () => {
  const agent = new IntakeAgent({ llmClient: mockClient('{}'), timeoutMs: 5_000 });

  test('throws PromptEmptyError for empty string', async () => {
    await expect(agent.parse('')).rejects.toBeInstanceOf(PromptEmptyError);
  });

  test('throws PromptEmptyError for whitespace-only prompt', async () => {
    await expect(agent.parse('   \n\t  ')).rejects.toBeInstanceOf(PromptEmptyError);
  });

  test('throws PromptTooLongError when prompt exceeds 10,000 characters', async () => {
    const long = 'x'.repeat(10_001);
    await expect(agent.parse(long)).rejects.toBeInstanceOf(PromptTooLongError);
  });

  test('accepts a prompt of exactly 10,000 characters', async () => {
    // LLM will return a valid response — input validation must pass
    const agent10k = new IntakeAgent({
      llmClient: mockClient(validResponse()),
      timeoutMs: 5_000,
    });
    const exactly10k = 'a'.repeat(10_000);
    await expect(agent10k.parse(exactly10k)).resolves.toBeDefined();
  });
});

describe('IntakeAgent — Happy Path', () => {
  let agent: IntakeAgent;
  let output: IntakeAgentOutput;

  beforeAll(async () => {
    agent = new IntakeAgent({ llmClient: mockClient(validResponse()), timeoutMs: 5_000 });
    output = await agent.parse('Find 100 Indian AI startups with funding > $1M');
  });

  test('returns structured_objective with correct target_entity', () => {
    expect(output.structured_objective.target_entity).toBe('AI startups');
  });

  test('returns interpretation_confidence in [0, 1]', () => {
    expect(output.interpretation_confidence).toBeGreaterThanOrEqual(0);
    expect(output.interpretation_confidence).toBeLessThanOrEqual(1);
    expect(output.interpretation_confidence).toBe(0.9);
  });

  test('returns required_fields correctly', () => {
    const fields = output.structured_objective.required_fields;
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('company_name');
    expect(fields[0].type).toBe('string');
    expect(fields[1].name).toBe('funding_usd');
    expect(fields[1].type).toBe('number');
  });

  test('returns data_sources correctly', () => {
    const sources = output.structured_objective.data_sources ?? [];
    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('web');
    expect(sources[0]!.hint).toBe('Crunchbase, LinkedIn');
  });

  test('returns output_requirements correctly', () => {
    const req = output.structured_objective.output_requirements;
    expect(req).toBeDefined();
    expect(req!.format).toBe('csv');
    expect(req!.max_records).toBe(100);
  });

  test('does NOT include clarification_needed when null from LLM', () => {
    expect(output.clarification_needed).toBeUndefined();
  });
});

describe('IntakeAgent — Constraint Extraction (all 6 operators)', () => {
  const operators = ['equals', 'contains', 'greater_than', 'less_than', 'between', 'in'] as const;

  for (const operator of operators) {
    test(`extracts constraint with operator '${operator}'`, async () => {
      const response = validResponse({
        constraints: [{ field: 'test_field', operator, value: 'test_value', source: null }],
      });
      const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
      const output = await agent.parse('Test prompt for constraint operator');
      const constraints = output.structured_objective.constraints;
      expect(constraints).toHaveLength(1);
      expect(constraints[0].operator).toBe(operator);
      expect(constraints[0].field).toBe('test_field');
    });
  }

  test('defaults unknown operator to "equals"', async () => {
    const response = validResponse({
      constraints: [{ field: 'year', operator: 'not_a_real_operator', value: 2024 }],
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find startups founded in 2024');
    expect(output.structured_objective.constraints[0].operator).toBe('equals');
  });

  test('filters out constraints with empty field names', async () => {
    const response = validResponse({
      constraints: [
        { field: '', operator: 'equals', value: 'x' },
        { field: 'country', operator: 'equals', value: 'India' },
      ],
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find Indian startups');
    expect(output.structured_objective.constraints).toHaveLength(1);
    expect(output.structured_objective.constraints[0].field).toBe('country');
  });
});

describe('IntakeAgent — Clarification Request Generation', () => {
  test('includes clarification_needed when LLM returns questions array', async () => {
    const response = validResponse({
      interpretation_confidence: 0.4,
      clarification_needed: {
        questions: ['Which country?', 'What time range?'],
        suggested_answers: ['India, USA, UK', 'Last 12 months'],
      },
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find startups');

    expect(output.clarification_needed).toBeDefined();
    expect(output.clarification_needed!.questions).toHaveLength(2);
    expect(output.clarification_needed!.questions[0]).toBe('Which country?');
    expect(output.clarification_needed!.suggested_answers).toHaveLength(2);
  });

  test('omits clarification_needed when LLM returns empty questions array', async () => {
    const response = validResponse({
      clarification_needed: { questions: [], suggested_answers: null },
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find 100 Indian AI startups');
    expect(output.clarification_needed).toBeUndefined();
  });

  test('omits suggested_answers when LLM omits them', async () => {
    const response = validResponse({
      clarification_needed: { questions: ['Which country?'] },
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find startups');
    expect(output.clarification_needed!.suggested_answers).toBeUndefined();
  });
});

describe('IntakeAgent — Assumption Documentation', () => {
  test('returns correctly parsed assumptions array', async () => {
    const response = validResponse({
      assumptions: [
        {
          description: 'Assuming Indian market only',
          confidence: 0.8,
          documentation: 'User said "Indian" in prompt',
        },
        {
          description: 'Assuming active startups only',
          confidence: 0.6,
          documentation: 'Common default interpretation',
        },
      ],
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find Indian AI startups');
    expect(output.assumptions).toHaveLength(2);
    expect(output.assumptions[0].description).toBe('Assuming Indian market only');
    expect(output.assumptions[0].confidence).toBe(0.8);
    expect(output.assumptions[1].confidence).toBe(0.6);
  });

  test('filters out assumptions with empty descriptions', async () => {
    const response = validResponse({
      assumptions: [
        { description: '', confidence: 0.5, documentation: 'should be filtered' },
        { description: 'Valid assumption', confidence: 0.7, documentation: 'kept' },
      ],
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find startups');
    expect(output.assumptions).toHaveLength(1);
    expect(output.assumptions[0].description).toBe('Valid assumption');
  });

  test('clamps assumption confidence to [0, 1]', async () => {
    const response = validResponse({
      assumptions: [
        { description: 'Over-confident', confidence: 2.5, documentation: 'test' },
        { description: 'Negative', confidence: -0.3, documentation: 'test' },
      ],
    });
    const agent = new IntakeAgent({ llmClient: mockClient(response), timeoutMs: 5_000 });
    const output = await agent.parse('Find startups');
    expect(output.assumptions[0].confidence).toBe(1.0);
    expect(output.assumptions[1].confidence).toBe(0.0);
  });
});

describe('IntakeAgent — Timeout Behavior (30s)', () => {
  test('throws PromptParsingError when LLM hangs beyond timeout', async () => {
    const agent = new IntakeAgent({
      llmClient: hangingClient(),
      timeoutMs: 100, // 100ms for fast test
    });

    let err!: PromptParsingError;
    try {
      await agent.parse('Find startups');
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('timed out');
  });

  test('thrown PromptParsingError from timeout is not retryable', async () => {
    const agent = new IntakeAgent({
      llmClient: hangingClient(),
      timeoutMs: 100,
    });

    let err!: PromptParsingError;
    try {
      await agent.parse('Find startups');
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err.retryable).toBe(false);
  });
});

describe('IntakeAgent — LLM Error Handling', () => {
  test('throws PromptParsingError when LLM returns invalid JSON', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient('this is not json at all!!!'),
      timeoutMs: 5_000,
    });
    await expect(agent.parse('Find startups')).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when target_entity is missing from LLM JSON', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient(JSON.stringify({ constraints: [], required_fields: [] })),
      timeoutMs: 5_000,
    });
    await expect(agent.parse('Find startups')).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when target_entity is empty string', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient(validResponse({ target_entity: '   ' })),
      timeoutMs: 5_000,
    });
    await expect(agent.parse('Find startups')).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('wraps generic LLM network errors as PromptParsingError', async () => {
    const agent = new IntakeAgent({
      llmClient: failingClient(new Error('Network error: ECONNRESET')),
      timeoutMs: 5_000,
    });
    let err!: PromptParsingError;
    try {
      await agent.parse('Find startups');
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }
    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('LLM call failed');
  });

  test('does NOT double-wrap PromptEmptyError from inner validation', async () => {
    // validate prompt first before even touching the LLM
    const agent = new IntakeAgent({ llmClient: mockClient('{}'), timeoutMs: 5_000 });
    await expect(agent.parse('')).rejects.toBeInstanceOf(PromptEmptyError);
  });
});

describe('IntakeAgent — Interpretation Confidence Clamping', () => {
  test('clamps LLM confidence above 1.0 down to 1.0', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient(validResponse({ interpretation_confidence: 1.5 })),
      timeoutMs: 5_000,
    });
    const output = await agent.parse('Find startups');
    expect(output.interpretation_confidence).toBe(1.0);
  });

  test('clamps LLM confidence below 0.0 up to 0.0', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient(validResponse({ interpretation_confidence: -0.5 })),
      timeoutMs: 5_000,
    });
    const output = await agent.parse('Find startups');
    expect(output.interpretation_confidence).toBe(0.0);
  });

  test('defaults confidence to 0.5 when LLM returns non-numeric value', async () => {
    const agent = new IntakeAgent({
      llmClient: mockClient(validResponse({ interpretation_confidence: 'high' })),
      timeoutMs: 5_000,
    });
    const output = await agent.parse('Find startups');
    expect(output.interpretation_confidence).toBe(0.5);
  });
});
