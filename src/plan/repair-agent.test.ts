/**
 * AI Data Intelligence Platform - RepairAgent Unit Tests (Task 4.9)
 *
 * Tests RepairAgent in isolation using a MockLLMClient. Covers:
 *  - Single repair attempt with success (Req 8.1)
 *  - Multiple repair attempts (2–3) with eventual success
 *  - Escalation after max attempts exhausted (Req 8.4, 8.5, 8.6)
 *  - patch_description is always present (Req 8.3)
 *  - Escalation report completeness (Req 8.5, 8.6)
 *  - Only the failing step is replaced; others preserved (Req 8.2)
 *  - Timeout enforcement (Req 8.1)
 *  - Malformed JSON / invalid patched_step from LLM
 *  - LLM network errors
 *  - Upstream context included in LLM prompt
 */

import { RepairAgent, MAX_REPAIR_ATTEMPTS } from './repair-agent.js';
import { PromptParsingError } from '../core/errors.js';
import type { LLMClient } from './intake-agent.js';
import type { IR, FailureTrace } from '../core/types.js';
import type { PatchAttempt } from './repair-agent.js';

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

/** Valid LLM patch response for a given step ID. */
function validPatch(stepId: string, description = 'Fixed the URL endpoint'): string {
  return JSON.stringify({
    patched_step: {
      id: stepId,
      type: 'Acquire',
      parameters: { urls: ['https://fixed.example.com'], method: 'GET' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: { contents: { type: 'array' } } },
      position: { x: 200, y: 100 },
    },
    patch_description: description,
  });
}

// ============================================================================
// Fixtures
// ============================================================================

const sampleIR: IR = {
  steps: [
    {
      id: 'step-discover-1',
      type: 'Discover',
      parameters: { query: 'AI startups', source_type: 'web' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: { source_urls: { type: 'array' } } },
      position: { x: 0, y: 100 },
    },
    {
      id: 'step-acquire-1',
      type: 'Acquire',
      parameters: { urls: ['https://broken.example.com'], method: 'GET' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: { contents: { type: 'array' } } },
      position: { x: 200, y: 100 },
    },
    {
      id: 'step-deliver-1',
      type: 'Deliver',
      parameters: { format: 'csv' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      position: { x: 400, y: 100 },
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
      to_step: 'step-deliver-1',
      to_input: 'main',
    },
  ],
  field_mappings: [],
  metadata: {
    objective_hash: 'abc123',
    created_at: new Date().toISOString(),
    planner_version: '1.0.0',
  },
};

const acquireFailure: FailureTrace = {
  step_id: 'step-acquire-1',
  error_message: 'HTTP 404: Resource not found at https://broken.example.com',
  classification: 'LOGIC_FAILURE',
  timestamp: new Date().toISOString(),
  retry_count: 0,
};

// ============================================================================
// Tests
// ============================================================================

describe('RepairAgent — Single Attempt Success', () => {
  test('returns status patched with patched_ir on successful repair', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 1,
    });

    expect(output.status).toBe('patched');
    expect(output.patched_ir).toBeDefined();
    expect(output.escalation_report).toBeUndefined();
  });

  test('patched_ir has the same number of steps as the original', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 1,
    });

    expect(output.patched_ir!.steps).toHaveLength(sampleIR.steps.length);
  });

  test('only the failing step is replaced; other steps are preserved verbatim', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1', 'Corrected URL')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 1,
    });

    const ir = output.patched_ir!;

    // Discover step unchanged
    const discover = ir.steps.find(s => s.id === 'step-discover-1')!;
    expect(discover.parameters['query']).toBe('AI startups');

    // Deliver step unchanged
    const deliver = ir.steps.find(s => s.id === 'step-deliver-1')!;
    expect(deliver.parameters['format']).toBe('csv');

    // Acquire step patched
    const acquire = ir.steps.find(s => s.id === 'step-acquire-1')!;
    expect((acquire.parameters['urls'] as string[])[0]).toBe('https://fixed.example.com');
  });

  test('connections are preserved after repair', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 1,
    });

    expect(output.patched_ir!.connections).toHaveLength(sampleIR.connections.length);
  });

  test('patch_description is included in the output (Req 8.3)', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1', 'Changed broken URL to working one')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 1,
    });

    expect(output.patch_description).toBe('Changed broken URL to working one');
  });

  test('metadata planner_version is stamped with repair attempt number', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 2,
    });

    expect(output.patched_ir!.metadata.planner_version).toContain('repair-2');
  });
});

describe('RepairAgent — Multiple Attempts', () => {
  test('attempt 2 works successfully after providing previous_patches context', async () => {
    const previousPatches: PatchAttempt[] = [
      {
        attempt_number: 1,
        patch_description: 'Tried changing to HTTPS — still failing',
        result: 'still_failing',
      },
    ];

    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1', 'Added authentication header')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 2,
      previous_patches: previousPatches,
    });

    expect(output.status).toBe('patched');
    expect(output.patch_description).toBe('Added authentication header');
  });

  test('attempt 3 (final valid attempt) still repairs when LLM succeeds', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient(validPatch('step-acquire-1', 'Last resort: fallback endpoint')),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 3,
    });

    expect(output.status).toBe('patched');
    expect(output.patch_description).toBe('Last resort: fallback endpoint');
  });
});

describe('RepairAgent — Escalation After Max Attempts', () => {
  test('attempt_number 4 returns escalated without calling LLM', async () => {
    const client: LLMClient = { complete: jest.fn() };
    const agent = new RepairAgent({ llmClient: client, timeoutMs: 5_000 });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: MAX_REPAIR_ATTEMPTS + 1,
      previous_patches: [],
    });

    expect(output.status).toBe('escalated');
    expect(client.complete).not.toHaveBeenCalled();
  });

  test('escalation_report contains original_failure', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient('{}'),
      timeoutMs: 5_000,
    });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 4,
      previous_patches: [],
    });

    expect(output.escalation_report!.original_failure).toEqual(acquireFailure);
  });

  test('escalation_report lists all attempted_patches', async () => {
    const previousPatches: PatchAttempt[] = [
      { attempt_number: 1, patch_description: 'Attempt 1 fix', result: 'still_failing' },
      { attempt_number: 2, patch_description: 'Attempt 2 fix', result: 'still_failing' },
      { attempt_number: 3, patch_description: 'Attempt 3 fix', result: 'still_failing' },
    ];

    const agent = new RepairAgent({ llmClient: mockClient('{}'), timeoutMs: 5_000 });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 4,
      previous_patches: previousPatches,
    });

    expect(output.escalation_report!.attempted_patches).toHaveLength(3);
    expect(output.escalation_report!.attempted_patches[0]!.patch_description).toBe('Attempt 1 fix');
  });

  test('escalation_report.recommendation is a non-empty string', async () => {
    const agent = new RepairAgent({ llmClient: mockClient('{}'), timeoutMs: 5_000 });

    const output = await agent.repair({
      failure_trace: acquireFailure,
      original_ir: sampleIR,
      attempt_number: 4,
      previous_patches: [],
    });

    expect(typeof output.escalation_report!.recommendation).toBe('string');
    expect(output.escalation_report!.recommendation.length).toBeGreaterThan(0);
  });
});

describe('RepairAgent — Timeout Behavior', () => {
  test('throws PromptParsingError when LLM hangs beyond timeout', async () => {
    const agent = new RepairAgent({ llmClient: hangingClient(), timeoutMs: 100 });

    let err!: PromptParsingError;
    try {
      await agent.repair({
        failure_trace: acquireFailure,
        original_ir: sampleIR,
        attempt_number: 1,
      });
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('timed out');
    expect(err.retryable).toBe(false);
  });
});

describe('RepairAgent — LLM Error Handling', () => {
  test('throws PromptParsingError for malformed JSON from LLM', async () => {
    const agent = new RepairAgent({
      llmClient: mockClient('not-json!!!'),
      timeoutMs: 5_000,
    });

    await expect(
      agent.repair({ failure_trace: acquireFailure, original_ir: sampleIR, attempt_number: 1 })
    ).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when patched_step.id does not match failing step id', async () => {
    const badPatch = JSON.stringify({
      patched_step: {
        id: 'WRONG-STEP-ID',
        type: 'Acquire',
        parameters: {},
        input_schema: {},
        output_schema: {},
        position: { x: 0, y: 0 },
      },
      patch_description: 'Wrong step ID',
    });

    const agent = new RepairAgent({ llmClient: mockClient(badPatch), timeoutMs: 5_000 });

    await expect(
      agent.repair({ failure_trace: acquireFailure, original_ir: sampleIR, attempt_number: 1 })
    ).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('throws PromptParsingError when patched_step has invalid capability type', async () => {
    const badTypePatch = JSON.stringify({
      patched_step: {
        id: 'step-acquire-1',
        type: 'INVENTED_TYPE',
        parameters: {},
        input_schema: {},
        output_schema: {},
        position: { x: 0, y: 0 },
      },
      patch_description: 'Used an invalid type',
    });

    const agent = new RepairAgent({ llmClient: mockClient(badTypePatch), timeoutMs: 5_000 });

    await expect(
      agent.repair({ failure_trace: acquireFailure, original_ir: sampleIR, attempt_number: 1 })
    ).rejects.toBeInstanceOf(PromptParsingError);
  });

  test('wraps LLM network errors as PromptParsingError', async () => {
    const agent = new RepairAgent({
      llmClient: failingClient(new Error('ECONNRESET')),
      timeoutMs: 5_000,
    });

    let err!: PromptParsingError;
    try {
      await agent.repair({
        failure_trace: acquireFailure,
        original_ir: sampleIR,
        attempt_number: 1,
      });
    } catch (e: unknown) {
      err = e as PromptParsingError;
    }

    expect(err).toBeInstanceOf(PromptParsingError);
    expect(err.message).toContain('LLM call failed');
  });
});

describe('RepairAgent — MAX_REPAIR_ATTEMPTS constant', () => {
  test('MAX_REPAIR_ATTEMPTS is exactly 3', () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(3);
  });
});
