/**
 * AI Data Intelligence Platform - Data Contract Validator
 *
 * Task 7.1 — Validates data contracts between connected IR steps.
 * Ensures that all fields required by a downstream step's input_schema
 * are produced by the upstream step's output_schema, and that explicit
 * field_mappings cover all required downstream fields.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.5
 */

import type { IR, IRStep, JSONSchema, FieldMapping } from '../core/types.js';

// ============================================================================
// Public API types
// ============================================================================

/**
 * Describes a single data contract violation between two connected steps.
 * All errors include the specific field name (Requirement 14.3).
 */
export interface ContractError {
  /** Step producing data. */
  from_step: string;
  /** Step consuming data. */
  to_step: string;
  error_type: 'MISSING_FIELD' | 'TYPE_MISMATCH' | 'UNMAPPED_FIELD';
  /** The specific field that caused the error. */
  field: string;
  /** Human-readable description of the violation. */
  message: string;
}

export interface ContractValidationResult {
  /** True when no contract errors were found. */
  valid: boolean;
  errors: ContractError[];
  checked_contracts: number;
}

// ============================================================================
// DataContractValidator
// ============================================================================

/**
 * Validates data contracts for all connections in an IR.
 *
 * Checks:
 *  1. MISSING_FIELD — required downstream field is not present in upstream output_schema.
 *  2. TYPE_MISMATCH — field exists in both schemas but types are incompatible.
 *  3. UNMAPPED_FIELD — required downstream field has no explicit FieldMapping in the IR.
 *
 * Permissive: Steps with no input_schema.properties or no output_schema.properties
 * are skipped (avoids false positives for LLM-generated partial schemas).
 */
export class DataContractValidator {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Validate all connections in the IR.
   *
   * For each connection, the upstream step's output_schema is compared with
   * the downstream step's input_schema. The IR's field_mappings are used to
   * verify explicit mapping coverage (Requirement 14.5).
   */
  public validate(ir: IR): ContractValidationResult {
    const errors: ContractError[] = [];
    const stepMap = this.buildStepMap(ir.steps);

    for (const connection of ir.connections) {
      const upstreamStep = stepMap.get(connection.from_step);
      const downstreamStep = stepMap.get(connection.to_step);

      if (!upstreamStep || !downstreamStep) {
        // Reference to unknown step — structural checker handles this separately
        continue;
      }

      const upstreamSchema = upstreamStep.output_schema;
      const downstreamSchema = downstreamStep.input_schema;

      // Skip if either schema has no properties defined (permissive — Req 14.1 note)
      if (!upstreamSchema?.properties || !downstreamSchema?.properties) {
        continue;
      }

      // Collect field_mappings for this specific connection
      const relevantMappings = ir.field_mappings.filter(
        m => m.source_step === connection.from_step,
      );

      const connectionErrors = this.validateConnection(
        upstreamSchema,
        downstreamSchema,
        relevantMappings,
        connection.from_step,
        connection.to_step,
      );

      errors.push(...connectionErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
      checked_contracts: ir.connections.length,
    };
  }

  /**
   * Validate a single upstream→downstream schema pair with explicit field_mappings.
   *
   * Used directly by property tests to validate isolated schema pairs.
   */
  public validateConnection(
    upstreamSchema: JSONSchema,
    downstreamSchema: JSONSchema,
    fieldMappings: FieldMapping[],
    fromStep = 'upstream',
    toStep = 'downstream',
  ): ContractError[] {
    const errors: ContractError[] = [];

    const upstreamProps = upstreamSchema.properties ?? {};
    const downstreamProps = downstreamSchema.properties ?? {};
    const requiredFields = downstreamSchema.required ?? [];

    // Build lookup sets
    const mappedTargetFields = new Set(fieldMappings.map(m => m.target_field));

    for (const fieldName of requiredFields) {
      const downstreamField = Object.prototype.hasOwnProperty.call(downstreamProps, fieldName) ? downstreamProps[fieldName] : undefined;
      const upstreamField = Object.prototype.hasOwnProperty.call(upstreamProps, fieldName) ? upstreamProps[fieldName] : undefined;

      if (!upstreamField) {
        // Requirement 14.2: required field not produced by upstream
        errors.push({
          from_step: fromStep,
          to_step: toStep,
          error_type: 'MISSING_FIELD',
          field: fieldName,
          message: `Required field '${fieldName}' is not present in upstream step '${fromStep}' output_schema`,
        });
        continue;
      }

      // Requirement 14.1: type compatibility check
      const typeError = this.checkTypeCompatibility(
        fieldName,
        upstreamField,
        downstreamField,
        fromStep,
        toStep,
      );
      if (typeError) {
        errors.push(typeError);
      }

      // Requirement 14.5: explicit field_mapping coverage
      if (!mappedTargetFields.has(fieldName)) {
        errors.push({
          from_step: fromStep,
          to_step: toStep,
          error_type: 'UNMAPPED_FIELD',
          field: fieldName,
          message: `Required field '${fieldName}' has no explicit FieldMapping in the IR for connection '${fromStep}' → '${toStep}'`,
        });
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildStepMap(steps: IRStep[]): Map<string, IRStep> {
    const map = new Map<string, IRStep>();
    for (const step of steps) {
      map.set(step.id, step);
    }
    return map;
  }

  /**
   * Check type compatibility between upstream and downstream field schemas.
   * Returns a ContractError if types are incompatible, null otherwise.
   *
   * Permissive: if either field has no explicit type, skip the check.
   */
  private checkTypeCompatibility(
    fieldName: string,
    upstreamField: JSONSchema | undefined,
    downstreamField: JSONSchema | undefined,
    fromStep: string,
    toStep: string,
  ): ContractError | null {
    if (!upstreamField?.type || !downstreamField?.type) {
      return null; // Permissive — no type declared, no check needed
    }

    const upstreamType = this.normalizeType(upstreamField.type);
    const downstreamType = this.normalizeType(downstreamField.type);

    // Types match exactly
    if (upstreamType === downstreamType) return null;

    // integer is a subtype of number — allow upstream integer → downstream number
    if (upstreamType === 'integer' && downstreamType === 'number') return null;

    return {
      from_step: fromStep,
      to_step: toStep,
      error_type: 'TYPE_MISMATCH',
      field: fieldName,
      message:
        `Field '${fieldName}': upstream '${fromStep}' produces type '${upstreamType}' ` +
        `but downstream '${toStep}' requires type '${downstreamType}'`,
    };
  }

  /** Normalize JSONSchemaType | JSONSchemaType[] to a single string for comparison. */
  private normalizeType(type: JSONSchema['type']): string {
    if (Array.isArray(type)) {
      // Take the first non-null type
      return type.find(t => t !== 'null') ?? 'null';
    }
    return type ?? 'any';
  }
}
