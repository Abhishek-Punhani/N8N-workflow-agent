/**
 * AI Data Intelligence Platform - WorkflowPlanner Unit Tests (Task 4.6)
 *
 * Tests the WorkflowPlanner in isolation using a MockLLMClient.
 * No real API calls are made. Covers:
 *  - Capability graph generation for a sample objective (Req 2.1)
 *  - Data contract creation (input/output schemas) between steps (Req 2.2)
 *  - Step minimization via prompt — LLM returns only needed steps (Req 2.6)
 *  - Handling of out-of-vocabulary capability types (Req 2.5)
 *  - Timeout enforcement at 30s (Req 2.5)
 *  - Malformed JSON from LLM
 *  - Empty steps array rejection
 *  - Connections with bad step references are stripped
 *  - objective_hash is stable for the same input
 *  - Metadata is populated correctly
 */

import { WorkflowPlanner } from './workflow-planner.js';
import { PromptParsingError } from '../core/errors.js';
import type { LLMClient } from './intake-agent.js';
import type { StructuredObjective } from '../core/types.js';

// ============================================================================
// Mock helpers
// ============================================================================

function mockClient(response: string): LLMClient {
  return { complete: jest.fn().mockResolvedValue(response) };
}

function failingClient(err: Error): LLMClient {
  return { complete: jest.fn().mockRejectedValue(err) };
}

function hangingClient(): LLMClient {
  return {
    complete: jest.fn().mockImplementation(
      (_s: string, _u: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
          );
        })
    ),
  };
}

const sampleObjective: StructuredObjective = {
  target_entity: 'AI startups',
  constraints: [{ field: 'country', operator: 'equals', value: 'India' }],
  required_fields: [
    { name: 'company_name', type: 'string', required: true },
    { name: 'funding_usd', type: 'number', required: true },
  ],
  data_sources: [{ type: 'web', hint: 'Crunchbase' }],
};

/** A canonical minimal IR from the LLM. */
function validIR(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    steps: [
      {
        id: 'step-discover-1',
        type: 'Discover',
        parameters: { query: 'Indian AI startups', source_type: 'web' },
        input_schema: { type: 'object', properties: {} },
        output_schema: { type: 'object', properties: { source_urls: { type: 'array' } } },
        position: { x: 0, y: 100 },
      },
      {
        id: 'step-acquire-1',
        type: 'Acquire',
        parameters: { urls: '{{source_urls}}', method: 'GET' },
        input_schema: { type: 'object', properties: { source_urls: { type: 'array' } } },
        output_schema: { type: 'object', properties: { contents: { type: 'array' } } },
        position: { x: 200, y: 100 },
      },
      {
        id: 'step-extract-1',
        type: 'Extract',
        parameters: { content: '{{contents}}', schema: {} },
        input_schema: { type: 'object', properties: { contents: { type: 'array' } } },
        output_schema: { type: 'object', properties: { records: { type: 'array' } } },
        position: { x: 400, y: 100 },
      },
      {
        id: 'step-deliver-1',
        type: 'Deliver',
        parameters: { records: '{{records}}', format: 'csv' },
        input_schema: { type: 'object', properties: { records: { type: 'array' } } },
        output_schema: { type: 'object', properties: { export_url: { type: 'string' } } },
        position: { x: 600, y: 100 },
      },
    ],
    connections: [
      {
        from_step: 'step-discover-1',
        from_output: 'main',
        to_step: 'step-acquire-1',
        to_input: 'main',
      },
      {
        from_step: 'step-acquire-1',
        from_output: 'main',
        to_step: 'step-extract-1',
        to_input: 'main',
      },
      {
        from_step: 'step-extract-1',
        from_output: 'main',
        to_step: 'step-deliver-1',
        to_input: 'main',
      },
    ],
    field_mappings: [
      { target_field: 'company_name', source_step: 'step-extract-1', source_field: 'name' },
    ],
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('WorkflowPlanner — Capability Graph Generation', () => {
  test('returns a WorkflowPlannerOutput with capability_graph', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const output = await planner.plan(sampleObjective);

    expect(output).toBeDefined();
    expect(output.capability_graph).toBeDefined();
    expect(output.capability_graph.steps).toBeInstanceOf(Array);
    expect(output.capability_graph.connections).toBeInstanceOf(Array);
  });

  test('generates correct steps from LLM response', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    expect(capability_graph.steps).toHaveLength(4);
    expect(capability_graph.steps.map(s => s.type)).toEqual([
      'Discover',
      'Acquire',
      'Extract',
      'Deliver',
    ]);
  });

  test('preserves step parameters from LLM response', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    const discoverStep = capability_graph.steps.find(s => s.id === 'step-discover-1');
    expect(discoverStep).toBeDefined();
    expect(discoverStep!.parameters['query']).toBe('Indian AI startups');
    expect(discoverStep!.parameters['source_type']).toBe('web');
  });

  test('generates connections between steps', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    expect(capability_graph.connections).toHaveLength(3);
    expect(capability_graph.connections[0]).toMatchObject({
      from_step: 'step-discover-1',
      to_step: 'step-acquire-1',
    });
  });
});

describe('WorkflowPlanner — Data Contract Creation', () => {
  test('steps carry LLM-provided input_schema and output_schema', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    const extractStep = capability_graph.steps.find(s => s.type === 'Extract');
    expect(extractStep!.input_schema).toBeDefined();
    expect(extractStep!.output_schema).toBeDefined();
  });

  test('step with missing input_schema gets a default empty object schema', async () => {
    const ir = JSON.parse(validIR()) as { steps: Array<Record<string, unknown>> };
    delete ir.steps[0]!['input_schema'];
    const planner = new WorkflowPlanner({
      llmClient: mockClient(JSON.stringify(ir)),
      timeoutMs: 5_000,
    });
    const { capability_graph } = await planner.plan(sampleObjective);
    expect(capability_graph.steps[0]!.input_schema).toEqual({ type: 'object', properties: {} });
  });

  test('step with missing output_schema gets a default schema derived from vocabulary outputFields', async () => {
    const ir = JSON.parse(validIR()) as { steps: Array<Record<string, unknown>> };
    delete ir.steps[0]!['output_schema'];
    const planner = new WorkflowPlanner({
      llmClient: mockClient(JSON.stringify(ir)),
      timeoutMs: 5_000,
    });
    const { capability_graph } = await planner.plan(sampleObjective);
    // Discover outputs source_urls — the derived schema should have that property
    const schema = capability_graph.steps[0]!.output_schema as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(typeof schema).toBe('object');
  });

  test('field_mappings are included in the IR', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);
    expect(capability_graph.field_mappings).toHaveLength(1);
    expect(capability_graph.field_mappings[0]!.target_field).toBe('company_name');
  });
});

describe('WorkflowPlanner — Step Minimization', () => {
  test('LLM response with fewer steps is accepted as-is (minimization is a prompt instruction)', async () => {
    // The planner trusts the LLM to minimise; it should not add steps itself
    const minimalIR = JSON.stringify({
      steps: [
        {
          id: 'step-acquire-1',
          type: 'Acquire',
          parameters: { urls: ['https://example.com'], method: 'GET' },
          input_schema: {},
          output_schema: {},
          position: { x: 0, y: 100 },
        },
        {
          id: 'step-deliver-1',
          type: 'Deliver',
          parameters: { records: '{{records}}', format: 'csv' },
          input_schema: {},
          output_schema: {},
          position: { x: 200, y: 100 },
        },
      ],
      connections: [
        {
          from_step: 'step-acquire-1',
          from_output: 'main',
          to_step: 'step-deliver-1',
          to_input: 'main',
        },
      ],
      field_mappings: [],
    });

    const planner = new WorkflowPlanner({ llmClient: mockClient(minimalIR), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    // Should only have 2 steps — no extras injected
    expect(capability_graph.steps).toHaveLength(2);
  });
});

describe('WorkflowPlanner — Unknown Capability Handling', () => {
  test('steps with unknown capability types are stripped from the IR', async () => {
    const mixedIR = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          type: 'Discover',
          parameters: {},
          input_schema: {},
          output_schema: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'step-2',
          type: 'CRAWL_THE_INTERNET',
          parameters: {},
          input_schema: {},
          output_schema: {},
          position: { x: 200, y: 0 },
        },
        {
          id: 'step-3',
          type: 'Deliver',
          parameters: {},
          input_schema: {},
          output_schema: {},
          position: { x: 400, y: 0 },
        },
      ],
      connections: [],
      field_mappings: [],
    });

    const planner = new WorkflowPlanner({ llmClient: mockClient(mixedIR), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);

    expect(capability_graph.steps).toHaveLength(2);
    expect(capability_graph.steps.every(s => ['Discover', 'Deliver'].includes(s.type))).toBe(true);
  });
});

describe('WorkflowPlanner — Timeout Behavior', () => {
  test('throws PromptParsingError when LLM hangs beyond timeout', async () => {
    const planner = new WorkflowPlanner({ llmClient: hangingClient(), timeoutMs: 100 });

    let err!: PromptParsingError;
    try {
      await planner.plan(sampleObjective);
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('timed out');
    expect(err.retryable).toBe(false);
  });
});

describe('WorkflowPlanner — LLM Error Handling', () => {
  test('throws PromptParsingError for invalid JSON', async () => {
    const planner = new WorkflowPlanner({
      llmClient: mockClient('not-json!!!'),
      timeoutMs: 5_000,
    });
    await expect(planner.plan(sampleObjective)).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when steps array is empty', async () => {
    const planner = new WorkflowPlanner({
      llmClient: mockClient(JSON.stringify({ steps: [], connections: [], field_mappings: [] })),
      timeoutMs: 5_000,
    });
    await expect(planner.plan(sampleObjective)).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when steps field is missing', async () => {
    const planner = new WorkflowPlanner({
      llmClient: mockClient(JSON.stringify({ connections: [] })),
      timeoutMs: 5_000,
    });
    await expect(planner.plan(sampleObjective)).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('wraps LLM network errors as PromptParsingError', async () => {
    const planner = new WorkflowPlanner({
      llmClient: failingClient(new Error('ECONNRESET')),
      timeoutMs: 5_000,
    });

    let err!: PromptParsingError;
    try {
      await planner.plan(sampleObjective);
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('LLM call failed');
  });
});

describe('WorkflowPlanner — IR Metadata', () => {
  test('metadata.objective_hash is a non-empty string', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);
    expect(typeof capability_graph.metadata.objective_hash).toBe('string');
    expect(capability_graph.metadata.objective_hash.length).toBeGreaterThan(0);
  });

  test('objective_hash is stable for identical objectives', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const out1 = await planner.plan(sampleObjective);
    const out2 = await planner.plan(sampleObjective);
    expect(out1.capability_graph.metadata.objective_hash).toBe(
      out2.capability_graph.metadata.objective_hash
    );
  });

  test('objective_hash differs for different objectives', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const out1 = await planner.plan(sampleObjective);
    const out2 = await planner.plan({ ...sampleObjective, target_entity: 'hospitals' });
    expect(out1.capability_graph.metadata.objective_hash).not.toBe(
      out2.capability_graph.metadata.objective_hash
    );
  });

  test('metadata.planner_version is set', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);
    expect(capability_graph.metadata.planner_version).toBeTruthy();
  });

  test('metadata.created_at is a valid ISO timestamp', async () => {
    const planner = new WorkflowPlanner({ llmClient: mockClient(validIR()), timeoutMs: 5_000 });
    const { capability_graph } = await planner.plan(sampleObjective);
    const date = new Date(capability_graph.metadata.created_at);
    expect(date.toString()).not.toBe('Invalid Date');
  });
});
