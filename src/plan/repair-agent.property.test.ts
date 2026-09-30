/**
 * AI Data Intelligence Platform - RepairAgent Property Tests (Task 4.8)
 *
 * Property-based tests proving:
 *  - Property 17: Repair Attempt Limit — RepairAgent NEVER exceeds 3 repair attempts
 *
 * Validates: Requirement 8.4
 */

import fc from 'fast-check';
import { RepairAgent, MAX_REPAIR_ATTEMPTS } from './repair-agent.js';
import type { LLMClient } from './intake-agent.js';
import type { IR, FailureTrace } from '../core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function agentWithPatch(patchedStepId: string): RepairAgent {
  const response = JSON.stringify({
    patched_step: {
      id: patchedStepId,
      type: 'Acquire',
      parameters: { urls: ['https://fixed.example.com'], method: 'GET' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      position: { x: 0, y: 0 },
    },
    patch_description: 'Fixed the URL to a reachable endpoint',
  });

  const client: LLMClient = { complete: jest.fn().mockResolvedValue(response) };
  return new RepairAgent({ llmClient: client, timeoutMs: 5_000 });
}

const minimalIR: IR = {
  steps: [
    {
      id: 'step-acquire-1',
      type: 'Acquire',
      parameters: { urls: ['https://broken.example.com'], method: 'GET' },
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      position: { x: 0, y: 100 },
    },
  ],
  connections: [],
  field_mappings: [],
  metadata: {
    objective_hash: 'abc123',
    created_at: new Date().toISOString(),
    planner_version: '1.0.0',
  },
};

const sampleTrace: FailureTrace = {
  step_id: 'step-acquire-1',
  error_message: 'HTTP 404: Resource not found',
  classification: 'LOGIC_FAILURE',
  timestamp: new Date().toISOString(),
  retry_count: 0,
};

// ============================================================================
// Property 17 — Repair Attempt Limit
// ============================================================================

describe('Property 17: Repair Attempt Limit', () => {
  test('attempt_number > MAX_REPAIR_ATTEMPTS always returns escalated status without calling LLM', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_REPAIR_ATTEMPTS + 1, max: MAX_REPAIR_ATTEMPTS + 100 }),
        async attemptNumber => {
          const client: LLMClient = { complete: jest.fn() };
          const agent = new RepairAgent({ llmClient: client, timeoutMs: 5_000 });

          const output = await agent.repair({
            failure_trace: sampleTrace,
            original_ir: minimalIR,
            attempt_number: attemptNumber,
            previous_patches: [],
          });

          // Must escalate — no LLM call should be made
          expect(output.status).toBe('escalated');
          expect(output.escalation_report).toBeDefined();
          expect(client.complete).not.toHaveBeenCalled();
        }
      )
    );
  });

  test('attempt_number in [1, MAX_REPAIR_ATTEMPTS] attempts LLM repair', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: MAX_REPAIR_ATTEMPTS }), async attemptNumber => {
        const agent = agentWithPatch('step-acquire-1');

        const output = await agent.repair({
          failure_trace: sampleTrace,
          original_ir: minimalIR,
          attempt_number: attemptNumber,
        });

        // Valid attempt — must produce a patched IR
        expect(output.status).toBe('patched');
        expect(output.patched_ir).toBeDefined();
        expect(output.patch_description).toBeDefined();
      })
    );
  });

  test('patched_ir always contains the same number of steps as original_ir', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: MAX_REPAIR_ATTEMPTS }), async attemptNumber => {
        const agent = agentWithPatch('step-acquire-1');

        const output = await agent.repair({
          failure_trace: sampleTrace,
          original_ir: minimalIR,
          attempt_number: attemptNumber,
        });

        if (output.status === 'patched') {
          expect(output.patched_ir!.steps.length).toBe(minimalIR.steps.length);
        }
      })
    );
  });
});
