/**
 * AI Data Intelligence Platform - WorkflowPlanner Property Tests (Task 4.5)
 *
 * Property-based tests proving structural guarantees over any generated IR:
 *  - Property 2: Capability Vocabulary Closure — all step types are in the closed vocabulary
 *  - Property 3: IR Connection Validity — all connections reference existing step IDs
 *  - Property 4: IR Parameter Completeness — steps carry a parameters object
 *
 * Validates: Requirements 2.1, 2.2, 2.4
 */

import fc from 'fast-check';
import { WorkflowPlanner } from './workflow-planner.js';
import { isValidCapabilityType, getCapabilityTypes } from '../core/capabilities.js';
import type { LLMClient } from './intake-agent.js';
import type { StructuredObjective } from '../core/types.js';
import type { IR, IRStep, IRConnection } from '../core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function plannerWithIR(ir: Partial<IR>): WorkflowPlanner {
  const response = JSON.stringify(ir);
  const client: LLMClient = { complete: jest.fn().mockResolvedValue(response) };
  return new WorkflowPlanner({ llmClient: client, timeoutMs: 5_000 });
}

const minimalObjective: StructuredObjective = {
  target_entity: 'companies',
  constraints: [],
  required_fields: [],
};

// ============================================================================
// fast-check arbitraries
// ============================================================================

const validCapabilityTypeArb = fc.constantFrom(...getCapabilityTypes());

const validStepArb = (id: string) =>
  fc.record({
    id: fc.constant(id),
    type: validCapabilityTypeArb,
    parameters: fc.dictionary(fc.string(), fc.string()),
    input_schema: fc.constant({ type: 'object', properties: {} }),
    output_schema: fc.constant({ type: 'object', properties: {} }),
    position: fc.record({ x: fc.integer(), y: fc.integer() }),
  });

// ============================================================================
// Property 2 — Capability Vocabulary Closure
// ============================================================================

describe('Property 2: Capability Vocabulary Closure', () => {
  test('all step types returned by WorkflowPlanner are in the closed vocabulary', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validStepArb('step-1'), { minLength: 1, maxLength: 5 }),
        async stepsTemplate => {
          // Give each step a unique ID
          const steps: IRStep[] = stepsTemplate.map((s, i) => ({ ...s, id: `step-${i}` }));
          const connections: IRConnection[] = [];
          for (let i = 0; i < steps.length - 1; i++) {
            connections.push({
              from_step: steps[i]!.id,
              from_output: 'main',
              to_step: steps[i + 1]!.id,
              to_input: 'main',
            });
          }

          const planner = plannerWithIR({ steps, connections, field_mappings: [] });
          const output = await planner.plan(minimalObjective);

          for (const step of output.capability_graph.steps) {
            expect(isValidCapabilityType(step.type)).toBe(true);
          }
        }
      )
    );
  });

  test('steps with invalid type strings are silently dropped', async () => {
    // Intentionally bad type — cast through unknown to bypass TS strict check
    // so we can test the runtime rejection path.
    const badSteps = [
      {
        id: 'step-1',
        type: 'INVALID_TYPE',
        parameters: {},
        input_schema: {},
        output_schema: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 'step-2',
        type: 'Discover',
        parameters: {},
        input_schema: {},
        output_schema: {},
        position: { x: 200, y: 0 },
      },
    ] as unknown as IRStep[];

    const planner = plannerWithIR({ steps: badSteps, connections: [], field_mappings: [] });
    const output = await planner.plan(minimalObjective);

    // Only the valid step should survive
    expect(output.capability_graph.steps).toHaveLength(1);
    expect(output.capability_graph.steps[0]!.type).toBe('Discover');
  });
});

// ============================================================================
// Property 3 — IR Connection Validity
// ============================================================================

describe('Property 3: IR Connection Validity', () => {
  test('all connections in output reference step IDs that exist in the steps array', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async stepCount => {
        const steps: IRStep[] = Array.from({ length: stepCount }, (_, i) => ({
          id: `step-${i}`,
          type: 'Extract' as const,
          parameters: {},
          input_schema: { type: 'object', properties: {} },
          output_schema: { type: 'object', properties: {} },
          position: { x: i * 200, y: 100 },
        }));

        const connections: IRConnection[] = steps.slice(0, -1).map((s, i) => ({
          from_step: s.id,
          from_output: 'main',
          to_step: steps[i + 1]!.id,
          to_input: 'main',
        }));

        const planner = plannerWithIR({ steps, connections, field_mappings: [] });
        const output = await planner.plan(minimalObjective);

        const stepIds = new Set(output.capability_graph.steps.map(s => s.id));

        for (const conn of output.capability_graph.connections) {
          expect(stepIds.has(conn.from_step)).toBe(true);
          expect(stepIds.has(conn.to_step)).toBe(true);
        }
      })
    );
  });

  test('connections referencing non-existent steps are stripped', async () => {
    const steps: IRStep[] = [
      {
        id: 'step-1',
        type: 'Discover',
        parameters: {},
        input_schema: {},
        output_schema: {},
        position: { x: 0, y: 0 },
      },
    ];
    const connections = [
      { from_step: 'step-1', from_output: 'main', to_step: 'GHOST-STEP', to_input: 'main' },
      { from_step: 'GHOST-STEP', from_output: 'main', to_step: 'step-1', to_input: 'main' },
    ];

    const planner = plannerWithIR({ steps, connections, field_mappings: [] });
    const output = await planner.plan(minimalObjective);

    // All bad connections stripped
    expect(output.capability_graph.connections).toHaveLength(0);
  });
});

// ============================================================================
// Property 4 — IR Parameter Completeness
// ============================================================================

describe('Property 4: IR Parameter Completeness', () => {
  test('every step in output IR has a parameters object', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validCapabilityTypeArb, { minLength: 1, maxLength: 10 }),
        async types => {
          const steps: IRStep[] = types.map((type, i) => ({
            id: `step-${i}`,
            type,
            parameters: { url: 'https://example.com', method: 'GET' },
            input_schema: { type: 'object', properties: {} },
            output_schema: { type: 'object', properties: {} },
            position: { x: i * 200, y: 100 },
          }));

          const planner = plannerWithIR({ steps, connections: [], field_mappings: [] });
          const output = await planner.plan(minimalObjective);

          for (const step of output.capability_graph.steps) {
            expect(step.parameters).toBeDefined();
            expect(typeof step.parameters).toBe('object');
            expect(step.parameters).not.toBeNull();
          }
        }
      )
    );
  });

  test('steps with null parameters are normalised to empty object', async () => {
    // Intentionally null parameters — cast through unknown to test runtime normalisation
    const steps = [
      {
        id: 'step-1',
        type: 'Provenance',
        parameters: null,
        input_schema: {},
        output_schema: {},
        position: { x: 0, y: 0 },
      },
    ] as unknown as IRStep[];

    const planner = plannerWithIR({ steps, connections: [], field_mappings: [] });
    const output = await planner.plan(minimalObjective);

    expect(output.capability_graph.steps[0]!.parameters).toEqual({});
  });
});
