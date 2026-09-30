/**
 * AI Data Intelligence Platform - Contract Check Validator
 *
 * Deterministic proof generator that verifies a compiled n8n workflow's
 * output satisfies the user's required fields and provenance constraints.
 *
 * Algorithm (design doc §6):
 *  1. Locate the final Deliver step node in the workflow.
 *  2. Collect every field name that node produces (from its parameters).
 *  3. Compute the set difference: required_fields − produced_fields.
 *  4. If the difference is empty and provenance is satisfied → certify.
 *  5. Otherwise → return ContractViolation array.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */

import type {
  N8NWorkflow,
  N8NNode,
  FieldDefinition,
  ContractCertificate,
  ContractViolation,
  ContractCheckResult,
} from '../core/types.js';

// ============================================================================
// Constants
// ============================================================================

const VALIDATOR_VERSION = '1.0.0';

/**
 * n8n node type that represents the final "Deliver" capability.
 * Matches the template registry entry for the Deliver capability.
 */
const DELIVER_NODE_TYPE = 'n8n-nodes-base.Webhook';

/**
 * The special field name that the provenance check looks for in the
 * final node's output, per requirement 6.4 and design doc §6.
 */
const PROVENANCE_FIELD = 'source_url';

// ============================================================================
// Input type (matches ContractCheckInput in verify/types.ts)
// ============================================================================

export interface ContractCheckInput {
  /** The compiled and validated n8n workflow to check. */
  workflow_json: N8NWorkflow;
  /** Fields the user declared as required in their objective. */
  required_fields: FieldDefinition[];
  /** Whether the objective requires provenance (source_url) on every record. */
  provenance_required: boolean;
}

// ============================================================================
// ContractCheck class
// ============================================================================

/**
 * ContractCheck proves a workflow's output satisfies the user's data contract.
 *
 * It is fully deterministic — no LLM calls, no I/O, no side effects.
 * Runtime is O(n) in the number of required fields.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6
 */
export class ContractCheck {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Verify that the workflow's output satisfies the required data contract.
   *
   * @param input ContractCheckInput with workflow, required_fields, provenance flag.
   * @returns     ContractCheckResult with status 'certified' or 'violation'.
   */
  public verify(input: ContractCheckInput): ContractCheckResult {
    const { workflow_json, required_fields, provenance_required } = input;
    const checkedAt = new Date().toISOString();

    // 1. Find the final output node (Deliver node, or last node as fallback)
    const finalNode = this.findFinalNode(workflow_json);

    // 2. Collect the set of field names produced by the final node
    const producedFields = this.collectProducedFields(finalNode);

    // 3. Compute set difference: required but not produced
    const violations: ContractViolation[] = [];

    for (const field of required_fields) {
      if (!producedFields.has(field.name)) {
        violations.push({
          missing_field: field.name,
          expected_type: field.type,
          required_by: 'user_objective',
        });
      }
    }

    // 4. Provenance check — source_url must be in produced fields when required
    if (provenance_required && !producedFields.has(PROVENANCE_FIELD)) {
      violations.push({
        missing_field: PROVENANCE_FIELD,
        expected_type: 'url',
        required_by: 'provenance_requirement',
      });
    }

    // 5a. Violations found → return violation result
    if (violations.length > 0) {
      return {
        status: 'violation',
        violations,
        checked_at: checkedAt,
      };
    }

    // 5b. All fields satisfied → return certificate
    const satisfiedFieldNames = required_fields.map(f => f.name);

    const certificate: ContractCertificate = {
      satisfied_fields: satisfiedFieldNames,
      satisfied_required_fields: required_fields,
      provenance_verified: provenance_required,
      certification_timestamp: checkedAt,
      validator_version: VALIDATOR_VERSION,
    };

    return {
      status: 'certified',
      certificate,
      checked_at: checkedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Private: node selection
  // -------------------------------------------------------------------------

  /**
   * Find the final output node in the workflow.
   *
   * Strategy (in priority order):
   *  1. The Deliver node (n8n-nodes-base.Webhook) — the canonical output node.
   *  2. The last node in the nodes array — fallback for workflows without a
   *     Deliver step (e.g. early-stage partial workflows).
   *
   * Rationale: the design doc algorithm states "collect all output fields from
   * the final Deliver step", but we must not crash on non-Deliver workflows.
   */
  private findFinalNode(workflow: N8NWorkflow): N8NNode | undefined {
    // Prefer the Deliver node by type
    const deliverNode = workflow.nodes.find(n => n.type === DELIVER_NODE_TYPE);
    if (deliverNode) return deliverNode;

    // Fallback: last node
    return workflow.nodes.length > 0 ? workflow.nodes[workflow.nodes.length - 1] : undefined;
  }

  // -------------------------------------------------------------------------
  // Private: field collection
  // -------------------------------------------------------------------------

  /**
   * Collect the set of field names that a node produces.
   *
   * n8n nodes declare their output schema in several ways depending on
   * the node type. We extract field names from the following locations
   * (all treated as "produced fields"):
   *
   *  a. node.parameters.responseBody   — Webhook / Deliver nodes
   *  b. node.parameters.fields         — Generic field list parameter
   *  c. node.parameters.outputFields   — Explicit output schema
   *  d. node.parameters.mappings       — Field mapping objects with "name"
   *  e. Top-level parameter keys       — Any parameter key is a candidate field
   *     (used as the broadest fallback so that simple workflows are not
   *      penalised for not declaring explicit output schemas)
   *
   * The special field `_provenance` and its child `source_url` are checked
   * separately via the provenance_required flag.
   */
  private collectProducedFields(node: N8NNode | undefined): Set<string> {
    const fields = new Set<string>();

    if (!node) return fields;

    const params = node.parameters ?? {};

    // (a) responseBody — typically an object whose keys are field names
    this.extractFieldNamesFromValue(params['responseBody'], fields);

    // (b) fields — array of { name, value } objects
    this.extractFieldNamesFromValue(params['fields'], fields);

    // (c) outputFields — array of field name strings or { name } objects
    this.extractFieldNamesFromValue(params['outputFields'], fields);

    // (d) mappings — array of { name, sourceField } objects
    this.extractFieldNamesFromValue(params['mappings'], fields);

    // (e) Top-level parameter keys as fallback field names
    for (const key of Object.keys(params)) {
      if (
        key !== 'responseBody' &&
        key !== 'fields' &&
        key !== 'outputFields' &&
        key !== 'mappings'
      ) {
        fields.add(key);
      }
    }

    return fields;
  }

  /**
   * Recursively extract field name strings from an arbitrary parameter value.
   *
   * Handles:
   *  - string  → treated as the field name itself
   *  - { name: string } → extracts the "name" key
   *  - { [key: string]: any } (plain object) → all top-level keys are field names
   *  - array → recurses into each element
   */
  private extractFieldNamesFromValue(value: unknown, out: Set<string>): void {
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      if (value.length > 0) out.add(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.extractFieldNamesFromValue(item, out);
      }
      return;
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // If the object has a "name" key, treat it as a named field descriptor
      if (typeof obj['name'] === 'string' && obj['name'].length > 0) {
        out.add(obj['name']);
      } else {
        // Plain object — all top-level keys are produced field names
        for (const key of Object.keys(obj)) {
          out.add(key);
        }
      }
    }
  }
}
