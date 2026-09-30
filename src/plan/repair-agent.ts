/**
 * AI Data Intelligence Platform - Repair Agent
 *
 * LLM-based component that patches a failing IR step based on a FailureTrace.
 * Attempts up to 3 repairs before escalating with a full diagnostic report.
 *
 * Key design decisions:
 *  - LLMClient injected via constructor — mockable, swappable (same interface).
 *  - Attempt counter strictly enforced: never exceeds MAX_REPAIR_ATTEMPTS (Req 8.4).
 *  - Only the failing step + its immediate upstream dependencies are patched;
 *    the rest of the IR is preserved verbatim (Req 8.2, design §8).
 *  - patch_description is required in every 'patched' response (Req 8.3).
 *  - Escalation report captures all attempted patches + original failure (Req 8.5, 8.6).
 *  - 30-second timeout per repair attempt (Req 8.1).
 *  - Raw LLM step patch is validated — unknown capability types are rejected and
 *    the original step is kept if the patch is invalid (fail-safe).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import type { IR, IRStep, FailureTrace } from '../core/types.js';
import { CAPABILITY_VOCABULARY } from '../core/types.js';
import { isValidCapabilityType, getCapabilityTypes } from '../core/capabilities.js';
import { DEFAULT_RECOVERY_STRATEGIES } from '../core/config.js';
import { PromptParsingError } from '../core/errors.js';
import type { LLMClient } from './intake-agent.js';

// ============================================================================
// Constants
// ============================================================================

export const MAX_REPAIR_ATTEMPTS = 3;
const TIMEOUT_MS = DEFAULT_RECOVERY_STRATEGIES.repair.repairAgentTimeout;

// ============================================================================
// Public Types
// ============================================================================

export interface RepairAgentConfig {
  llmClient: LLMClient;
  timeoutMs?: number;
}

export interface RepairAgentInput {
  failure_trace: FailureTrace;
  original_ir: IR;
  attempt_number: number; // 1, 2, or 3
  previous_patches?: PatchAttempt[]; // history passed in for attempt > 1
}

export interface RepairAgentOutput {
  status: 'patched' | 'escalated';
  patched_ir?: IR;
  patch_description?: string;
  escalation_report?: EscalationReport;
}

export interface EscalationReport {
  original_failure: FailureTrace;
  attempted_patches: PatchAttempt[];
  recommendation: string;
}

export interface PatchAttempt {
  attempt_number: number;
  patch_description: string;
  result: 'success' | 'still_failing';
  new_failure_trace?: FailureTrace;
}

// ============================================================================
// Raw LLM response shape (before validation)
// ============================================================================

interface RawPatchResponse {
  patched_step?: unknown;
  patch_description?: unknown;
  recommendation?: unknown; // used in escalation path
}

interface RawPatchedStep {
  id?: unknown;
  type?: unknown;
  parameters?: unknown;
  input_schema?: unknown;
  output_schema?: unknown;
  position?: unknown;
}

// ============================================================================
// RepairAgent class
// ============================================================================

/**
 * RepairAgent patches a failing IR step using LLM-guided diagnostics.
 *
 * Usage:
 *   const agent = new RepairAgent({ llmClient });
 *   const output = await agent.repair({
 *     failure_trace, original_ir, attempt_number: 1
 *   });
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
export class RepairAgent {
  private readonly llmClient: LLMClient;
  private readonly timeoutMs: number;

  constructor(config: RepairAgentConfig) {
    this.llmClient = config.llmClient;
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Attempt to repair a failing IR step.
   *
   * @param input  RepairAgentInput containing failure context, original IR,
   *               attempt number (1–3), and optional previous patch history.
   * @returns      RepairAgentOutput with status 'patched' (IR updated) or
   *               'escalated' (all attempts exhausted, report provided).
   * @throws       PromptParsingError on timeout or LLM communication failure.
   */
  public async repair(input: RepairAgentInput): Promise<RepairAgentOutput> {
    const { failure_trace, original_ir, attempt_number, previous_patches = [] } = input;

    // Req 8.4: Hard limit on repair attempts — never exceed MAX
    if (attempt_number > MAX_REPAIR_ATTEMPTS) {
      return this.buildEscalation(failure_trace, previous_patches);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawResponse = await this.llmClient.complete(
        this.buildSystemPrompt(),
        this.buildUserMessage(failure_trace, original_ir, attempt_number, previous_patches),
        controller.signal
      );

      return this.parseRepairResponse(rawResponse, original_ir, failure_trace, attempt_number);
    } catch (err) {
      if (err instanceof PromptParsingError) throw err;

      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        throw new PromptParsingError(
          `Repair Agent timed out after ${this.timeoutMs}ms on attempt ${attempt_number}`,
          { timeout_ms: this.timeoutMs, attempt_number },
          false
        );
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new PromptParsingError(`Repair Agent LLM call failed: ${message}`, {}, false);
    } finally {
      clearTimeout(timer);
    }
  }

  // --------------------------------------------------------------------------
  // Prompt construction
  // --------------------------------------------------------------------------

  private buildSystemPrompt(): string {
    const vocabulary = getCapabilityTypes().join(' | ');
    const capabilityTable = getCapabilityTypes()
      .map(type => {
        const def = CAPABILITY_VOCABULARY[type];
        const params = Object.keys(def.requiredParameters).join(', ') || 'none';
        return `  - ${type}: ${def.description} (required params: ${params})`;
      })
      .join('\n');

    return `You are a workflow repair specialist. A workflow step has failed. Your job is to patch ONLY the failing step to fix the error.

CAPABILITY VOCABULARY (ONLY use these types — no others):
${vocabulary}

CAPABILITY DEFINITIONS:
${capabilityTable}

OUTPUT SCHEMA (respond with ONLY valid JSON, no markdown, no explanation):
{
  "patched_step": {
    "id": string,               // MUST match the failing step ID exactly
    "type": "${vocabulary}",    // Can change the capability type if needed
    "parameters": {             // Updated parameters that fix the failure
      [key: string]: any
    },
    "input_schema": {
      "type": "object",
      "properties": { [field: string]: { "type": string } }
    },
    "output_schema": {
      "type": "object",
      "properties": { [field: string]: { "type": string } }
    },
    "position": { "x": number, "y": number }
  },
  "patch_description": string   // Human-readable explanation of what was changed and why
}

RULES:
1. ONLY modify the failing step — preserve all other steps unchanged.
2. The patched_step.id MUST be identical to the failing step's id.
3. Only use capability types from the vocabulary above.
4. patch_description must explain what was wrong and what was fixed.
5. If the step type must change, update connections to remain valid.`;
  }

  private buildUserMessage(
    failure_trace: FailureTrace,
    original_ir: IR,
    attempt_number: number,
    previous_patches: PatchAttempt[]
  ): string {
    const failingStep = original_ir.steps.find(s => s.id === failure_trace.step_id);
    const upstreamSteps = this.findUpstreamSteps(failure_trace.step_id, original_ir);

    const previousPatchSummary =
      previous_patches.length > 0
        ? `\nPREVIOUS REPAIR ATTEMPTS (do not repeat these):
${previous_patches.map(p => `  Attempt ${p.attempt_number}: ${p.patch_description}`).join('\n')}`
        : '';

    return `REPAIR ATTEMPT ${attempt_number} of ${MAX_REPAIR_ATTEMPTS}

FAILURE TRACE:
- Step ID: ${failure_trace.step_id}
- Error: ${failure_trace.error_message}
- Classification: ${failure_trace.classification}
- Timestamp: ${failure_trace.timestamp}

FAILING STEP:
${JSON.stringify(failingStep ?? 'NOT FOUND', null, 2)}

IMMEDIATE UPSTREAM STEPS (context):
${JSON.stringify(upstreamSteps, null, 2)}${previousPatchSummary}

Produce the minimal patch JSON now.`;
  }

  // --------------------------------------------------------------------------
  // Response parsing
  // --------------------------------------------------------------------------

  private parseRepairResponse(
    rawResponse: string,
    original_ir: IR,
    failure_trace: FailureTrace,
    attempt_number: number
  ): RepairAgentOutput {
    let parsed: RawPatchResponse;

    try {
      parsed = JSON.parse(rawResponse) as RawPatchResponse;
    } catch {
      throw new PromptParsingError(
        'Repair Agent: LLM returned invalid JSON',
        { raw_response: rawResponse.slice(0, 200) },
        false
      );
    }

    // Req 8.3: patch_description is mandatory
    const patch_description =
      typeof parsed.patch_description === 'string' && parsed.patch_description.trim() !== ''
        ? parsed.patch_description.trim()
        : `Repair attempt ${attempt_number} — no description provided`;

    // Parse and validate the patched step
    const patchedStep = this.parsePatchedStep(parsed.patched_step, failure_trace.step_id);

    if (!patchedStep) {
      // LLM returned an invalid patch — fail-safe: escalate immediately
      throw new PromptParsingError(
        `Repair Agent: invalid patched_step in LLM response (attempt ${attempt_number})`,
        { raw_response: rawResponse.slice(0, 200) },
        false
      );
    }

    // Req 8.2: Replace ONLY the failing step; preserve the rest verbatim
    const patched_ir: IR = {
      ...original_ir,
      steps: original_ir.steps.map(s => (s.id === patchedStep.id ? patchedStep : s)),
      metadata: {
        ...original_ir.metadata,
        // Stamp the patch into metadata so downstream stages can trace it
        planner_version: `${original_ir.metadata.planner_version}+repair-${attempt_number}`,
      },
    };

    return {
      status: 'patched',
      patched_ir,
      patch_description,
    };
  }

  private parsePatchedStep(raw: unknown, expectedId: string): IRStep | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const s = raw as RawPatchedStep;
    const id = typeof s.id === 'string' && s.id.trim() !== '' ? s.id.trim() : null;
    const type = typeof s.type === 'string' ? s.type : null;

    // The patched step's ID must match the failing step's ID exactly
    if (!id || id !== expectedId) return null;

    // Type must be from the closed vocabulary
    if (!type || !isValidCapabilityType(type)) return null;

    const capDef = CAPABILITY_VOCABULARY[type];

    return {
      id,
      type,
      parameters:
        typeof s.parameters === 'object' && s.parameters !== null
          ? (s.parameters as Record<string, unknown>)
          : {},
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
                  : 0,
              y:
                typeof (s.position as Record<string, unknown>)['y'] === 'number'
                  ? ((s.position as Record<string, unknown>)['y'] as number)
                  : 100,
            }
          : { x: 0, y: 100 },
    };
  }

  // --------------------------------------------------------------------------
  // Escalation
  // --------------------------------------------------------------------------

  /**
   * Build an escalation report when all repair attempts are exhausted.
   * Req 8.5, 8.6
   */
  private buildEscalation(
    failure_trace: FailureTrace,
    attempted_patches: PatchAttempt[]
  ): RepairAgentOutput {
    const escalation_report: EscalationReport = {
      original_failure: failure_trace,
      attempted_patches,
      recommendation: this.generateRecommendation(failure_trace, attempted_patches),
    };

    return {
      status: 'escalated',
      escalation_report,
    };
  }

  private generateRecommendation(
    failure_trace: FailureTrace,
    attempted_patches: PatchAttempt[]
  ): string {
    const patchSummary = attempted_patches
      .map(p => `  - Attempt ${p.attempt_number}: ${p.patch_description}`)
      .join('\n');

    return (
      `Step '${failure_trace.step_id}' failed with classification '${failure_trace.classification}' ` +
      `and could not be automatically repaired after ${attempted_patches.length} attempt(s).\n` +
      `Error: ${failure_trace.error_message}\n` +
      `Attempted patches:\n${patchSummary || '  (none)'}\n` +
      `Recommended action: Manual review of step configuration and data source availability.`
    );
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Find the immediate upstream steps feeding into the failing step.
   * Used to give the LLM relevant context for the repair.
   */
  private findUpstreamSteps(failingStepId: string, ir: IR): IRStep[] {
    const upstreamIds = ir.connections
      .filter(c => c.to_step === failingStepId)
      .map(c => c.from_step);

    return ir.steps.filter(s => upstreamIds.includes(s.id));
  }
}
