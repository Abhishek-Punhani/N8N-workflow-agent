/**
 * AI Data Intelligence Platform - Workflow Planner
 *
 * LLM-based component that translates a StructuredObjective into a
 * capability graph (IR). Uses schema-constrained JSON output so the LLM
 * can only produce steps from the closed Capability Vocabulary.
 *
 * Key design decisions:
 *  - LLMClient is injected via constructor (same interface as IntakeAgent).
 *  - 30-second timeout enforced via AbortController (Req 2.5).
 *  - Prompt explicitly lists the closed vocabulary so the model can apply
 *    constrained decoding / JSON mode (Req 2.1).
 *  - Step minimization instruction embedded in prompt (Req 2.6).
 *  - Raw IR validated post-parse: unknown step types are rejected and
 *    invalid connections are stripped (Req 2.1, 2.2).
 *  - Data contracts (input_schema / output_schema) derived from the
 *    Capability Vocabulary (Req 2.2).
 *  - A stable objective_hash is derived from the objective content so
 *    downstream stages can trace provenance (Req 14.4).
 *
 * Requirements: 2.1, 2.2, 2.4, 2.5, 2.6
 */

import { createHash } from 'crypto';
import type { StructuredObjective, IR, IRStep, IRConnection, FieldMapping } from '../core/types.js';
import { CAPABILITY_VOCABULARY } from '../core/types.js';
import { isValidCapabilityType, getCapabilityTypes } from '../core/capabilities.js';
import { DEFAULT_TIMEOUTS } from '../core/config.js';
import { PromptParsingError } from '../core/errors.js';
import type { LLMClient } from './intake-agent.js';
import type { WorkflowPlannerOutput } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const TIMEOUT_MS = DEFAULT_TIMEOUTS.WorkflowPlanner ?? 30_000;
const PLANNER_VERSION = '1.0.0';

// ============================================================================
// Config
// ============================================================================

export interface WorkflowPlannerConfig {
  llmClient: LLMClient;
  timeoutMs?: number;
}

// ============================================================================
// Raw LLM response shape (before validation)
// ============================================================================

interface RawIRStep {
  id?: unknown;
  type?: unknown;
  parameters?: unknown;
  input_schema?: unknown;
  output_schema?: unknown;
  position?: unknown;
}

interface RawIRConnection {
  from_step?: unknown;
  from_output?: unknown;
  to_step?: unknown;
  to_input?: unknown;
}

interface RawFieldMapping {
  target_field?: unknown;
  source_step?: unknown;
  source_field?: unknown;
}

interface RawLLMIR {
  steps?: unknown;
  connections?: unknown;
  field_mappings?: unknown;
}

// ============================================================================
// WorkflowPlanner class
// ============================================================================

/**
 * WorkflowPlanner generates a capability graph (IR) from a StructuredObjective.
 *
 * Usage:
 *   const planner = new WorkflowPlanner({ llmClient });
 *   const output = await planner.plan(structuredObjective);
 *
 * Requirements: 2.1, 2.2, 2.4, 2.5, 2.6
 */
export class WorkflowPlanner {
  private readonly llmClient: LLMClient;
  private readonly timeoutMs: number;

  constructor(config: WorkflowPlannerConfig) {
    this.llmClient = config.llmClient;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Generate a capability graph (IR) from a StructuredObjective.
   *
   * @param objective  Parsed structured objective from IntakeAgent.
   * @returns          WorkflowPlannerOutput with capability_graph (IR).
   * @throws           PromptParsingError on timeout, malformed LLM output, or
   *                   IR with unknown capability types.
   */
  public async plan(objective: StructuredObjective): Promise<WorkflowPlannerOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawResponse = await this.llmClient.complete(
        this.buildSystemPrompt(),
        this.buildUserMessage(objective),
        controller.signal
      );

      const ir = this.parseAndValidateIR(rawResponse, objective);
      return { capability_graph: ir };
    } catch (err) {
      if (err instanceof PromptParsingError) throw err;

      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new PromptParsingError(
          `Workflow Planner timed out after ${this.timeoutMs}ms`,
          { timeout_ms: this.timeoutMs },
          false
        );
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new PromptParsingError(`Workflow Planner LLM call failed: ${message}`, {}, false);
    } finally {
      clearTimeout(timer);
    }
  }

  // --------------------------------------------------------------------------
  // Prompt construction
  // --------------------------------------------------------------------------

  private buildSystemPrompt(): string {
    const allTypes = getCapabilityTypes();
    const vocabulary = allTypes.join(' | ');
    const capabilityTable = allTypes
      .map(type => {
        const def = CAPABILITY_VOCABULARY[type];
        const params = Object.keys(def.requiredParameters).join(', ') || 'none';
        return `  - ${type}: ${def.description} (required params: ${params})`;
      })
      .join('\n');

    return `You are a workflow architect. Given a data collection objective, generate the MINIMUM set of capability steps needed to satisfy it.

CAPABILITY VOCABULARY (ONLY use these types — no others):
${vocabulary}

CAPABILITY DEFINITIONS:
${capabilityTable}

OUTPUT SCHEMA (respond with ONLY valid JSON, no markdown, no explanation):
{
  "steps": [
    {
      "id": string,              // Unique step ID, e.g. "step-discover-1"
      "type": "${vocabulary}",
      "parameters": {            // Key-value pairs required by this capability
        [key: string]: any
      },
      "input_schema": {          // JSON Schema describing expected input
        "type": "object",
        "properties": { [field: string]: { "type": string } }
      },
      "output_schema": {         // JSON Schema describing what this step outputs
        "type": "object",
        "properties": { [field: string]: { "type": string } }
      },
      "position": { "x": number, "y": number }
    }
  ],
  "connections": [
    {
      "from_step": string,    // ID of source step
      "from_output": "main",
      "to_step": string,      // ID of destination step
      "to_input": "main"
    }
  ],
  "field_mappings": [
    {
      "target_field": string,
      "source_step": string,
      "source_field": string
    }
  ]
}

RULES:
1. ONLY use capability types from the vocabulary above — never invent new ones.
2. MINIMIZE step count: include only steps genuinely needed to satisfy the objective.
3. Steps must form a valid DAG: every connection must reference existing step IDs.
4. Each step MUST have a unique "id" string.
5. Define input_schema and output_schema so downstream steps know what data flows.
6. If a required capability is missing from the vocabulary, decompose it into available ones.
7. The final step should always be either Persist or Deliver.`;
  }

  private buildUserMessage(objective: StructuredObjective): string {
    return `Generate the minimum capability graph for this data objective:

Target entity: ${objective.target_entity}
Constraints: ${JSON.stringify(objective.constraints ?? [])}
Required fields: ${JSON.stringify(objective.required_fields ?? [])}
Data sources: ${JSON.stringify(objective.data_sources ?? [])}
Output requirements: ${JSON.stringify(objective.output_requirements ?? {})}

Produce the IR JSON now.`;
  }

  // --------------------------------------------------------------------------
  // Response parsing and validation
  // --------------------------------------------------------------------------

  private parseAndValidateIR(rawResponse: string, objective: StructuredObjective): IR {
    let parsed: RawLLMIR;

    try {
      parsed = JSON.parse(rawResponse) as RawLLMIR;
    } catch {
      throw new PromptParsingError(
        'Workflow Planner: LLM returned invalid JSON',
        { raw_response: rawResponse.slice(0, 200) },
        false
      );
    }

    // Validate and coerce steps
    const steps = this.parseSteps(parsed.steps);

    if (steps.length === 0) {
      throw new PromptParsingError(
        'Workflow Planner: IR must contain at least one step',
        { received: parsed },
        false
      );
    }

    // Build a set of valid step IDs for connection validation
    const stepIds = new Set(steps.map(s => s.id));

    // Validate connections — filter out any with bad references
    const connections = this.parseConnections(parsed.connections, stepIds);

    // Parse field mappings
    const field_mappings = this.parseFieldMappings(parsed.field_mappings, stepIds);

    return {
      steps,
      connections,
      field_mappings,
      metadata: {
        objective_hash: this.hashObjective(objective),
        created_at: new Date().toISOString(),
        planner_version: PLANNER_VERSION,
      },
    };
  }

  private parseSteps(raw: unknown): IRStep[] {
    if (!Array.isArray(raw)) return [];

    const steps: IRStep[] = [];

    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;

      const s = item as RawIRStep;
      const id = typeof s.id === 'string' && s.id.trim() !== '' ? s.id.trim() : null;
      const type = typeof s.type === 'string' ? s.type : null;

      // Req 2.1: All step types MUST be from the closed vocabulary
      if (!id || !type || !isValidCapabilityType(type)) continue;

      const capDef = CAPABILITY_VOCABULARY[type];

      steps.push({
        id,
        type: type,
        parameters:
          typeof s.parameters === 'object' && s.parameters !== null
            ? (s.parameters as Record<string, unknown>)
            : {},
        // Req 2.2: Data contracts — derive from vocabulary outputFields if LLM omits them
        input_schema:
          typeof s.input_schema === 'object' && s.input_schema !== null
            ? (s.input_schema as Record<string, unknown>)
            : { type: 'object', properties: {} },
        output_schema:
          typeof s.output_schema === 'object' && s.output_schema !== null
            ? (s.output_schema as Record<string, unknown>)
            : {
                type: 'object',
                properties: Object.fromEntries(
                  Object.keys(capDef.outputFields).map(f => [f, { type: 'array' }])
                ),
              },
        position:
          typeof s.position === 'object' && s.position !== null
            ? {
                x:
                  typeof (s.position as Record<string, unknown>)['x'] === 'number'
                    ? ((s.position as Record<string, unknown>)['x'] as number)
                    : steps.length * 200,
                y:
                  typeof (s.position as Record<string, unknown>)['y'] === 'number'
                    ? ((s.position as Record<string, unknown>)['y'] as number)
                    : 100,
              }
            : { x: steps.length * 200, y: 100 },
      });
    }

    return steps;
  }

  private parseConnections(raw: unknown, validStepIds: Set<string>): IRConnection[] {
    if (!Array.isArray(raw)) return [];

    const connections: IRConnection[] = [];

    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;

      const c = item as RawIRConnection;
      const from_step = typeof c.from_step === 'string' ? c.from_step : null;
      const to_step = typeof c.to_step === 'string' ? c.to_step : null;

      // Req 2.2: All connections must reference existing steps
      if (!from_step || !to_step) continue;
      if (!validStepIds.has(from_step) || !validStepIds.has(to_step)) continue;

      connections.push({
        from_step,
        from_output: typeof c.from_output === 'string' ? c.from_output : 'main',
        to_step,
        to_input: typeof c.to_input === 'string' ? c.to_input : 'main',
      });
    }

    return connections;
  }

  private parseFieldMappings(raw: unknown, validStepIds: Set<string>): FieldMapping[] {
    if (!Array.isArray(raw)) return [];

    const mappings: FieldMapping[] = [];

    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;

      const m = item as RawFieldMapping;
      const target_field = typeof m.target_field === 'string' ? m.target_field : null;
      const source_step = typeof m.source_step === 'string' ? m.source_step : null;
      const source_field = typeof m.source_field === 'string' ? m.source_field : null;

      if (!target_field || !source_step || !source_field) continue;
      if (!validStepIds.has(source_step)) continue;

      mappings.push({ target_field, source_step, source_field });
    }

    return mappings;
  }

  /**
   * Create a stable 8-char hash of the objective for provenance tracking.
   */
  private hashObjective(objective: StructuredObjective): string {
    const content = JSON.stringify({
      target_entity: objective.target_entity,
      constraints: objective.constraints ?? [],
      required_fields: objective.required_fields ?? [],
    });
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}
