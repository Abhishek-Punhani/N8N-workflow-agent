import {
  N8NWorkflow,
  TemplateManifest,
  N8NNode,
  TemplateReference,
  CapabilityType,
} from '../core/types.js';
import { CompilerInput, CompilerResult } from './types.js';
import { getTemplateConfig, createNodeFromTemplate } from '../core/template-registry.js';
import { ValidationError } from '../core/errors.js';

export class Compiler {
  /**
   * Compiles a verified IR into an executable n8n workflow JSON.
   * @param input CompilerInput containing verified IR
   * @returns CompilerResult with workflow JSON and manifest
   */
  public compile(input: CompilerInput): CompilerResult {
    try {
      const { verified_ir } = input;
      const { ir } = verified_ir;

      const nodes: N8NNode[] = [];
      const nodeMap = new Map<string, N8NNode>();

      const templateUsage = new Map<
        string,
        {
          capability: CapabilityType;
          nodeCount: number;
        }
      >();

      // 1. Build nodes mapping capability types to n8n node templates
      for (const step of ir.steps) {
        const templateConfig = getTemplateConfig(step.type);

        const position: [number, number] = step.position
          ? [step.position.x, step.position.y]
          : [nodes.length * 200, 100];

        const node = createNodeFromTemplate(step.type, step.id, step.parameters, position);

        nodes.push(node);
        nodeMap.set(step.id, node);

        const existing = templateUsage.get(templateConfig.template_id);
        if (existing) {
          existing.nodeCount += 1;
        } else {
          templateUsage.set(templateConfig.template_id, {
            capability: step.type,
            nodeCount: 1,
          });
        }
      }

      // 2. Generate n8n connections from IR connections
      const connections: N8NWorkflow['connections'] = {};

      for (const conn of ir.connections) {
        const fromNode = nodeMap.get(conn.from_step);
        const toNode = nodeMap.get(conn.to_step);

        if (!fromNode) {
          throw new ValidationError(
            `Connection references unknown source step '${conn.from_step}'`
          );
        }

        if (!toNode) {
          throw new ValidationError(
            `Connection references unknown destination step '${conn.to_step}'`
          );
        }

        // Default to 'main' if not explicitly defined by IR
        const outputType = conn.from_output || 'main';

        if (!connections[fromNode.name]) {
          connections[fromNode.name] = {};
        }

        if (!connections[fromNode.name][outputType]) {
          connections[fromNode.name][outputType] = [];
        }

        connections[fromNode.name][outputType].push({
          node: toNode.name,
          type: 'main',
          index: 0,
        });
      }

      // 3. Assemble final workflow JSON
      const workflow_json: N8NWorkflow = {
        name: `Workflow from Objective ${ir.metadata?.objective_hash?.substring(0, 8) ?? 'unknown'}`,
        nodes,
        connections,
        settings: {},
        staticData: {
          version: 1,
        },
      };

      // 4. Create template manifest
      const templates_used: TemplateReference[] = [];
      for (const [template_id, usage] of templateUsage.entries()) {
        templates_used.push({
          template_id,
          capability_mapped: usage.capability,
          node_count: usage.nodeCount,
        });
      }

      const manifest: TemplateManifest = {
        templates_used,
        total_nodes: nodes.length,
        compilation_timestamp: new Date().toISOString(),
      };

      return {
        status: 'success',
        workflow_json,
        manifest,
      };
    } catch (error) {
      return {
        status: 'error',
        errors: [error instanceof Error ? error.message : 'Unknown compilation error'],
      };
    }
  }
}
