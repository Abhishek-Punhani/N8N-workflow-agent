import fc from 'fast-check';
import { Compiler } from './compiler.js';
import { CompilerInput } from './types.js';
import { IR, CapabilityType, IRConnection, IRStep } from '../core/types.js';
import { getTemplateConfig } from '../core/template-registry.js';

// Custom arbitrary to generate a valid CapabilityType
const capabilityTypeArb = fc.constantFrom<CapabilityType>(
  'Discover',
  'Acquire',
  'Extract',
  'Transform',
  'Enrich',
  'Resolve',
  'Filter',
  'Validate',
  'Provenance',
  'Persist',
  'Deliver'
);

// Custom arbitrary to generate IR parameters
const parametersArb = fc.dictionary(fc.string(), fc.string());

// Custom arbitrary to generate a valid IRStep
const irStepArb = fc.record({
  id: fc.uuid(),
  type: capabilityTypeArb,
  parameters: parametersArb,
  input_schema: fc.constant({ type: 'object' }),
  output_schema: fc.constant({ type: 'object' }),
  position: fc.record({ x: fc.integer(), y: fc.integer() }),
}) as fc.Arbitrary<IRStep>;

describe('Compiler Property Tests', () => {
  let compiler: Compiler;

  beforeEach(() => {
    compiler = new Compiler();
  });

  test('Properties 10, 11, 12, 13', () => {
    fc.assert(
      fc.property(fc.array(irStepArb, { minLength: 1, maxLength: 20 }), steps => {
        // Generate valid connections between the generated steps
        const connections: IRConnection[] = [];
        for (let i = 0; i < steps.length - 1; i++) {
          connections.push({
            from_step: steps[i].id,
            from_output: 'main',
            to_step: steps[i + 1].id,
            to_input: 'main',
          });
        }

        const ir: IR = {
          steps,
          connections,
          field_mappings: [],
          metadata: {
            objective_hash: 'test-hash',
            created_at: new Date().toISOString(),
            planner_version: '1.0.0',
          },
        };

        const input: CompilerInput = {
          verified_ir: {
            ir,
            validated_at: new Date().toISOString(),
            validator_version: '1.0.0',
          },
        };

        const result = compiler.compile(input);

        // Property 13: Output Completeness
        // Compiler must return workflow_json + manifest
        expect(result.status).toBe('success');
        expect(result.workflow_json).toBeDefined();
        expect(result.manifest).toBeDefined();

        const workflow = result.workflow_json!;
        const manifest = result.manifest!;

        // Property 10: Output Validity
        // Given valid IR, produce syntactically valid JSON with nodes and connections
        expect(workflow.nodes).toBeDefined();
        expect(Array.isArray(workflow.nodes)).toBe(true);
        expect(workflow.nodes.length).toBe(steps.length);
        expect(workflow.connections).toBeDefined();
        expect(typeof workflow.connections).toBe('object');

        // Property 11: Capability Mapping
        // Must map capability types to correct templates
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const expectedTemplate = getTemplateConfig(step.type);
          const node = workflow.nodes.find(n => n.id === step.id);

          expect(node).toBeDefined();
          expect(node!.type).toBe(expectedTemplate.node_type);

          // Verify it's in the manifest
          const manifestEntry = manifest.templates_used.find(
            t => t.template_id === expectedTemplate.template_id
          );
          expect(manifestEntry).toBeDefined();
          expect(manifestEntry!.capability_mapped).toBe(step.type);
        }

        // Property 12: Connection Assembly
        // Given A -> B, output must contain A -> B
        for (const conn of connections) {
          const fromNode = workflow.nodes.find(n => n.id === conn.from_step)!;
          const toNode = workflow.nodes.find(n => n.id === conn.to_step)!;

          const n8nConnections = workflow.connections[fromNode.name];
          expect(n8nConnections).toBeDefined();

          const outputType = conn.from_output || 'main';
          expect(n8nConnections[outputType]).toBeDefined();

          const target = n8nConnections[outputType].find(c => c.node === toNode.name);
          expect(target).toBeDefined();
          // Based on our implementation we always map to 'main'
          expect(target!.type).toBe('main');
        }
      })
    );
  });
});
