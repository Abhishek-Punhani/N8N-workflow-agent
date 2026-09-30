/**
 * AI Data Intelligence Platform - Compiler Property-Based Tests
 *
 * Properties 10-13 as defined in tasks.md §2.4
 * Uses fast-check for property-based testing (100+ iterations per property).
 *
 * Property 10: Output Validity      — Produce syntactically valid n8n JSON with nodes and connections
 * Property 11: Capability Mapping   — Map capability types to correct n8n templates
 * Property 12: Connection Assembly  — Generate valid n8n linkages from IR connections
 * Property 13: Output Completeness  — Include workflow JSON and template manifest
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.6
 */

import * as fc from 'fast-check';
import { Compiler } from './compiler.js';
import type { CompilerInput } from './types.js';
import type { IR, IRStep, IRConnection, CapabilityType } from '../core/types.js';
import { TEMPLATE_REGISTRY, getTemplateConfig } from '../core/template-registry.js';

// ============================================================================
// Shared constants
// ============================================================================

const ALL_CAPABILITY_TYPES = Object.keys(TEMPLATE_REGISTRY) as CapabilityType[];

// ============================================================================
// Arbitraries (fast-check generators)
// ============================================================================

/** One of the 11 valid capability types. */
const arbCapabilityType: fc.Arbitrary<CapabilityType> = fc.constantFrom(...ALL_CAPABILITY_TYPES);

/**
 * A non-empty UUID-like step ID that is unique enough for property tests.
 * Using fc.uuid() ensures no accidental collisions within a generated array.
 */
const arbStepId = fc.uuid();

/** Minimal IRStep — parameters are empty because the Compiler accepts any Record. */
const arbIRStep: fc.Arbitrary<IRStep> = fc.record({
  id: arbStepId,
  type: arbCapabilityType,
  parameters: fc.dictionary(fc.string({ minLength: 1 }), fc.string()),
  input_schema: fc.constant({ type: 'object' as const }),
  output_schema: fc.constant({ type: 'object' as const }),
  position: fc.record({ x: fc.integer(), y: fc.integer() }),
}) as fc.Arbitrary<IRStep>;

/**
 * Build a chain of connections from a step array: step[0]→step[1]→…→step[n-1].
 * This guarantees every connection references an existing step ID.
 */
function chainConnections(steps: IRStep[]): IRConnection[] {
  const conns: IRConnection[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    conns.push({
      from_step: steps[i].id,
      from_output: 'main',
      to_step: steps[i + 1].id,
      to_input: 'main',
    });
  }
  return conns;
}

/** Build a complete IR from steps + connections. */
function makeIR(steps: IRStep[], connections: IRConnection[] = []): IR {
  return {
    steps,
    connections,
    field_mappings: [],
    metadata: {
      objective_hash: 'testhash1234',
      created_at: new Date().toISOString(),
      planner_version: '1.0.0',
    },
  };
}

/** Wrap an IR in a CompilerInput (VerifiedIR wrapper). */
function makeInput(ir: IR): CompilerInput {
  return {
    verified_ir: {
      ir,
      validated_at: new Date().toISOString(),
      validator_version: '1.0.0',
    },
  };
}

/** Arbitrary: 1–15 steps with unique IDs, chained connections. */
const arbLinearIR: fc.Arbitrary<IR> = fc
  .uniqueArray(arbIRStep, { minLength: 1, maxLength: 15, selector: s => s.id })
  .map(steps => makeIR(steps, chainConnections(steps)));

// ============================================================================
// Property 10: Output Validity
//
// "Given valid IR, produce syntactically valid n8n JSON with nodes and connections"
//
// Every field of N8NWorkflow must be present and correctly typed:
//   • name      : non-empty string
//   • nodes     : array with one entry per IR step, each a well-formed N8NNode
//   • connections: plain object (may be empty when there are no connections)
//   • settings  : object
//   • staticData: object
//
// Each N8NNode must have:
//   • id         : the original step id
//   • name       : non-empty string
//   • type       : non-empty string (the n8n node type)
//   • typeVersion: positive integer
//   • position   : [number, number] tuple
//   • parameters : object
//
// Requirements: 4.1, 4.4 (valid n8n JSON accepted by the n8n API)
// ============================================================================

describe('Property 10: Output Validity', () => {
  const compiler = new Compiler();

  it('produces a result with status "success" for any valid IR', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');
      }),
      { numRuns: 100 }
    );
  });

  it('produces a workflow with the correct top-level structure', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const wf = result.workflow_json!;

        // name must be a non-empty string
        expect(typeof wf.name).toBe('string');
        expect(wf.name.length).toBeGreaterThan(0);

        // nodes must be an array
        expect(Array.isArray(wf.nodes)).toBe(true);

        // connections must be a plain object
        expect(typeof wf.connections).toBe('object');
        expect(wf.connections).not.toBeNull();
        expect(Array.isArray(wf.connections)).toBe(false);

        // settings and staticData must be objects
        expect(typeof wf.settings).toBe('object');
        expect(typeof wf.staticData).toBe('object');
      }),
      { numRuns: 100 }
    );
  });

  it('produces exactly one n8n node per IR step', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');
        expect(result.workflow_json!.nodes.length).toBe(ir.steps.length);
      }),
      { numRuns: 100 }
    );
  });

  it('every generated node is a well-formed N8NNode', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        for (const node of result.workflow_json!.nodes) {
          // id must be a non-empty string
          expect(typeof node.id).toBe('string');
          expect(node.id.length).toBeGreaterThan(0);

          // name must be a non-empty string
          expect(typeof node.name).toBe('string');
          expect(node.name.length).toBeGreaterThan(0);

          // type must be a non-empty string
          expect(typeof node.type).toBe('string');
          expect(node.type.length).toBeGreaterThan(0);

          // typeVersion must be a positive integer
          expect(typeof node.typeVersion).toBe('number');
          expect(node.typeVersion).toBeGreaterThan(0);
          expect(Number.isInteger(node.typeVersion)).toBe(true);

          // position must be a 2-tuple of numbers
          expect(Array.isArray(node.position)).toBe(true);
          expect(node.position).toHaveLength(2);
          expect(typeof node.position[0]).toBe('number');
          expect(typeof node.position[1]).toBe('number');

          // parameters must be a plain object
          expect(typeof node.parameters).toBe('object');
          expect(node.parameters).not.toBeNull();
          expect(Array.isArray(node.parameters)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('every node ID corresponds to an IR step ID', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const stepIds = new Set(ir.steps.map(s => s.id));
        for (const node of result.workflow_json!.nodes) {
          expect(stepIds.has(node.id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 11: Capability Mapping
//
// "Map capability types to correct n8n templates"
//
// For every IR step, the compiled node must:
//   • Use the node_type from TEMPLATE_REGISTRY[step.type]
//   • Have a manifest entry for its template_id
//   • The manifest entry's capability_mapped must equal step.type
//
// When multiple steps share the same capability type, node_count in the manifest
// entry for that template must reflect the total.
//
// Requirements: 4.1, 4.2 (capability-to-template mapping)
// ============================================================================

describe('Property 11: Capability Mapping', () => {
  const compiler = new Compiler();

  it('assigns each node the n8n type declared in the template registry', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const wf = result.workflow_json!;

        for (const step of ir.steps) {
          const expectedConfig = getTemplateConfig(step.type);
          const node = wf.nodes.find(n => n.id === step.id);

          expect(node).toBeDefined();
          expect(node!.type).toBe(expectedConfig.node_type);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('includes a manifest entry for every template used', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const manifest = result.manifest!;
        const usedTemplateIds = new Set(ir.steps.map(s => getTemplateConfig(s.type).template_id));

        for (const templateId of usedTemplateIds) {
          const entry = manifest.templates_used.find(t => t.template_id === templateId);
          expect(entry).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('each manifest entry correctly records the capability_mapped for its template', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const manifest = result.manifest!;

        for (const step of ir.steps) {
          const expectedConfig = getTemplateConfig(step.type);
          const entry = manifest.templates_used.find(
            t => t.template_id === expectedConfig.template_id
          );

          expect(entry).toBeDefined();
          expect(entry!.capability_mapped).toBe(step.type);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('node_count in manifest equals the number of IR steps using that template', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const manifest = result.manifest!;

        // Compute expected count per template_id from the IR
        const expectedCounts = new Map<string, number>();
        for (const step of ir.steps) {
          const tid = getTemplateConfig(step.type).template_id;
          expectedCounts.set(tid, (expectedCounts.get(tid) ?? 0) + 1);
        }

        for (const [templateId, expectedCount] of expectedCounts.entries()) {
          const entry = manifest.templates_used.find(t => t.template_id === templateId);
          expect(entry).toBeDefined();
          expect(entry!.node_count).toBe(expectedCount);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('manifest contains no extra template entries beyond those used by IR steps', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const usedTemplateIds = new Set(ir.steps.map(s => getTemplateConfig(s.type).template_id));
        for (const entry of result.manifest!.templates_used) {
          expect(usedTemplateIds.has(entry.template_id)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 12: Connection Assembly
//
// "Generate valid n8n linkages from IR connections"
//
// For each IR connection A → B:
//   • workflow.connections[A.name] must exist
//   • workflow.connections[A.name][from_output] must be an array
//   • That array must contain an entry pointing to B.name
//   • The entry's type field must be 'main'
//   • The entry's index field must be a non-negative integer
//
// An IR with no connections must produce an empty connections object.
//
// Requirements: 4.3 (proper n8n node linkages with correct data flow)
// ============================================================================

describe('Property 12: Connection Assembly', () => {
  const compiler = new Compiler();

  it('every IR connection appears in workflow.connections with the correct target node', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        // Only meaningful when there are connections
        if (ir.connections.length === 0) return;

        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const wf = result.workflow_json!;
        const nodeById = new Map(wf.nodes.map(n => [n.id, n]));

        for (const conn of ir.connections) {
          const fromNode = nodeById.get(conn.from_step)!;
          const toNode = nodeById.get(conn.to_step)!;

          // The from-node must have a connections entry
          const fromConns = wf.connections[fromNode.name];
          expect(fromConns).toBeDefined();

          // The correct output key must exist
          const outputKey = conn.from_output || 'main';
          expect(fromConns[outputKey]).toBeDefined();
          expect(Array.isArray(fromConns[outputKey])).toBe(true);

          // One of the entries must point to the to-node
          const target = fromConns[outputKey].find(c => c.node === toNode.name);
          expect(target).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('every connection entry has type "main" and a non-negative index', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        if (ir.connections.length === 0) return;

        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const wf = result.workflow_json!;
        const nodeById = new Map(wf.nodes.map(n => [n.id, n]));

        for (const conn of ir.connections) {
          const fromNode = nodeById.get(conn.from_step)!;
          const outputKey = conn.from_output || 'main';
          const target = wf.connections[fromNode.name][outputKey].find(
            c => c.node === nodeById.get(conn.to_step)!.name
          );

          expect(target).toBeDefined();
          expect(target!.type).toBe('main');
          expect(typeof target!.index).toBe('number');
          expect(target!.index).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('an IR with no connections produces an empty connections object', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbIRStep, { minLength: 1, maxLength: 10, selector: s => s.id }),
        steps => {
          const ir = makeIR(steps, []); // explicitly no connections
          const result = compiler.compile(makeInput(ir));
          expect(result.status).toBe('success');

          const connectionKeys = Object.keys(result.workflow_json!.connections);
          expect(connectionKeys).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles multiple outgoing connections from the same source step', () => {
    fc.assert(
      fc.property(
        // Need at least 3 unique steps so one can fan-out to two others
        fc.uniqueArray(arbIRStep, { minLength: 3, maxLength: 10, selector: s => s.id }),
        steps => {
          // step[0] → step[1] and step[0] → step[2] (fan-out)
          const connections: IRConnection[] = [
            { from_step: steps[0].id, from_output: 'main', to_step: steps[1].id, to_input: 'main' },
            { from_step: steps[0].id, from_output: 'main', to_step: steps[2].id, to_input: 'main' },
          ];
          const ir = makeIR(steps, connections);
          const result = compiler.compile(makeInput(ir));
          expect(result.status).toBe('success');

          const wf = result.workflow_json!;
          const nodeById = new Map(wf.nodes.map(n => [n.id, n]));
          const fromNodeName = nodeById.get(steps[0].id)!.name;
          const targets = wf.connections[fromNodeName]?.['main'] ?? [];

          const targetNames = targets.map(t => t.node);
          expect(targetNames).toContain(nodeById.get(steps[1].id)!.name);
          expect(targetNames).toContain(nodeById.get(steps[2].id)!.name);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 13: Output Completeness
//
// "Include workflow JSON and template manifest"
//
// On success:
//   • result.status === 'success'
//   • result.workflow_json is defined and non-null
//   • result.manifest is defined and non-null
//   • manifest.total_nodes equals ir.steps.length
//   • manifest.compilation_timestamp is a valid ISO 8601 date string
//   • manifest.templates_used is a non-empty array (at least one entry per unique capability)
//   • result.errors is undefined
//
// On invalid input (unknown connection target):
//   • result.status === 'error'
//   • result.errors is a non-empty array of strings
//   • result.workflow_json is undefined
//   • result.manifest is undefined
//
// Requirements: 4.6 (workflow JSON + template manifest returned)
// ============================================================================

describe('Property 13: Output Completeness', () => {
  const compiler = new Compiler();

  it('always returns both workflow_json and manifest on success', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');
        expect(result.workflow_json).toBeDefined();
        expect(result.workflow_json).not.toBeNull();
        expect(result.manifest).toBeDefined();
        expect(result.manifest).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('manifest.total_nodes equals the number of IR steps', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');
        expect(result.manifest!.total_nodes).toBe(ir.steps.length);
      }),
      { numRuns: 100 }
    );
  });

  it('manifest.compilation_timestamp is a valid ISO 8601 date string', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const ts = result.manifest!.compilation_timestamp;
        expect(typeof ts).toBe('string');
        expect(ts.length).toBeGreaterThan(0);

        const parsed = new Date(ts);
        expect(parsed.toString()).not.toBe('Invalid Date');
        // Must round-trip cleanly (ISO format)
        expect(isNaN(parsed.getTime())).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('manifest.templates_used has at least one entry per unique capability type in IR', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');

        const uniqueCapabilities = new Set(ir.steps.map(s => s.type));
        const manifestTemplateIds = new Set(
          result.manifest!.templates_used.map(t => t.template_id)
        );

        // Each unique capability must produce at least one manifest entry
        for (const cap of uniqueCapabilities) {
          const expectedId = getTemplateConfig(cap).template_id;
          expect(manifestTemplateIds.has(expectedId)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('does not set errors on a successful compilation', () => {
    fc.assert(
      fc.property(arbLinearIR, ir => {
        const result = compiler.compile(makeInput(ir));
        expect(result.status).toBe('success');
        expect(result.errors).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('returns status "error" with errors array and no workflow/manifest when compilation fails', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbIRStep, { minLength: 1, maxLength: 5, selector: s => s.id }),
        steps => {
          // Inject a connection to a non-existent step — the compiler must throw internally
          const badConnection: IRConnection = {
            from_step: steps[0].id,
            from_output: 'main',
            to_step: 'step-that-does-not-exist-xyz',
            to_input: 'main',
          };
          const ir = makeIR(steps, [badConnection]);
          const result = compiler.compile(makeInput(ir));

          expect(result.status).toBe('error');
          expect(result.errors).toBeDefined();
          expect(Array.isArray(result.errors)).toBe(true);
          expect(result.errors!.length).toBeGreaterThan(0);
          expect(result.errors!.every(e => typeof e === 'string')).toBe(true);

          // workflow_json and manifest must NOT be present on error
          expect(result.workflow_json).toBeUndefined();
          expect(result.manifest).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
