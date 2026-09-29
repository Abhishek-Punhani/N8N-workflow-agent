/**
 * AI Data Intelligence Platform - Structural Check Validator
 *
 * Validates an IR (Intermediate Representation) against the Capability Vocabulary
 * before compilation. Checks step types, parameter completeness, parameter types,
 * field references, and connection validity. Returns precise error locations
 * with step_id and parameter paths.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */

import type {
  IR,
  IRStep,
  IRConnection,
  StructuralError,
  StructuralErrorType,
  VerifiedIR,
  CapabilityType,
  ParameterType,
} from '../core/types.js';
import { CAPABILITY_VOCABULARY } from '../core/types.js';
import { isValidCapabilityType } from '../core/capabilities.js';
import type { StructuralCheckResult } from './types.js';

// ============================================================================
// Validator version
// ============================================================================

const VALIDATOR_VERSION = '1.0.0';

// ============================================================================
// StructuralCheck Class
// ============================================================================

/**
 * StructuralCheck validates an IR before it is passed to the Compiler.
 *
 * Checks performed (in order):
 *  1. Step type validation   — every step.type must be in the Capability Vocabulary
 *  2. Parameter completeness — every required parameter for the step's capability must be present
 *  3. Parameter type check   — present parameters must match the declared ParameterType
 *  4. Field reference check  — every connection's from_output field must exist in the
 *                              upstream step's output_schema, and to_input must exist in
 *                              the downstream step's input_schema
 *  5. Connection validity    — connections must reference step IDs that actually exist
 *
 * If any errors are found the method returns status 'invalid' with a populated errors array.
 * If all checks pass it wraps the IR in a VerifiedIR and returns status 'valid'.
 */
export class StructuralCheck {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run all structural validations against the provided IR.
   *
   * @param ir - The Intermediate Representation to validate.
   * @returns   StructuralCheckResult with status 'valid' / 'invalid'.
   */
  public validate(ir: IR): StructuralCheckResult {
    const errors: StructuralError[] = [];

    // Build a quick lookup map: step_id → IRStep
    const stepMap = this.buildStepMap(ir.steps);

    // Run each check, accumulating errors
    errors.push(...this.checkStepTypes(ir.steps));
    errors.push(...this.checkParameters(ir.steps));
    errors.push(...this.checkConnectionValidity(ir.connections, stepMap));
    errors.push(...this.checkFieldReferences(ir.connections, stepMap));

    if (errors.length > 0) {
      return { status: 'invalid', errors };
    }

    const verifiedIR: VerifiedIR = {
      ir,
      validated_at: new Date().toISOString(),
      validator_version: VALIDATOR_VERSION,
    };

    return { status: 'valid', verified_ir: verifiedIR };
  }

  // -------------------------------------------------------------------------
  // Check 1: Step type validation
  // -------------------------------------------------------------------------

  /**
   * Every step.type must be a member of the closed Capability Vocabulary.
   * Requirement: 3.1
   */
  private checkStepTypes(steps: IRStep[]): StructuralError[] {
    const errors: StructuralError[] = [];

    for (const step of steps) {
      if (!isValidCapabilityType(step.type)) {
        errors.push(
          this.makeError(
            step.id,
            'INVALID_STEP_TYPE',
            `Step type '${step.type}' is not in the Capability Vocabulary. ` +
              `Valid types: ${Object.keys(CAPABILITY_VOCABULARY).join(', ')}.`,
            { step: step.id }
          )
        );
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Check 2: Parameter completeness + type checking
  // -------------------------------------------------------------------------

  /**
   * For each step whose type is valid:
   *  a) Every required parameter defined in CAPABILITY_VOCABULARY must be present.
   *  b) Present parameters must be compatible with the declared ParameterType.
   *
   * Requirements: 3.2, 3.3
   */
  private checkParameters(steps: IRStep[]): StructuralError[] {
    const errors: StructuralError[] = [];

    for (const step of steps) {
      // Skip steps with an invalid type — already reported in checkStepTypes
      if (!isValidCapabilityType(step.type)) continue;

      const capabilityDef = CAPABILITY_VOCABULARY[step.type as CapabilityType];
      const requiredParams = capabilityDef.requiredParameters;

      for (const [paramName, expectedType] of Object.entries(requiredParams)) {
        // (a) Presence check
        if (!(paramName in step.parameters)) {
          errors.push(
            this.makeError(
              step.id,
              'MISSING_PARAMETER',
              `Step '${step.id}' (${step.type}) is missing required parameter '${paramName}'.`,
              { step: step.id, parameter: paramName }
            )
          );
          continue; // No point type-checking a missing parameter
        }

        // (b) Type check
        const actualValue = step.parameters[paramName];
        if (!this.isCompatibleType(actualValue, expectedType)) {
          errors.push(
            this.makeError(
              step.id,
              'INVALID_PARAMETER_TYPE',
              `Parameter '${paramName}' of step '${step.id}' (${step.type}) ` +
                `has wrong type. Expected '${expectedType}', ` +
                `got '${this.describeValueType(actualValue)}'.`,
              { step: step.id, parameter: paramName }
            )
          );
        }
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Check 3: Connection validity (referenced step IDs must exist)
  // -------------------------------------------------------------------------

  /**
   * Every connection must reference step IDs that actually exist in the IR.
   * Requirement: 3.4
   */
  private checkConnectionValidity(
    connections: IRConnection[],
    stepMap: Map<string, IRStep>
  ): StructuralError[] {
    const errors: StructuralError[] = [];

    for (const conn of connections) {
      if (!stepMap.has(conn.from_step)) {
        errors.push(
          this.makeError(
            conn.from_step,
            'UNDEFINED_FIELD_REFERENCE',
            `Connection references non-existent source step '${conn.from_step}'.`,
            { step: conn.from_step }
          )
        );
      }

      if (!stepMap.has(conn.to_step)) {
        errors.push(
          this.makeError(
            conn.to_step,
            'UNDEFINED_FIELD_REFERENCE',
            `Connection references non-existent target step '${conn.to_step}'.`,
            { step: conn.to_step }
          )
        );
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Check 4: Field reference validation
  // -------------------------------------------------------------------------

  /**
   * For each connection:
   *  - conn.from_output must appear in the upstream step's output_schema.properties
   *  - conn.to_input   must appear in the downstream step's input_schema.properties
   *
   * If schemas have no properties defined we skip the check (permissive for
   * LLM-generated IRs that omit schema detail).
   *
   * Requirement: 3.3, 3.4
   */
  private checkFieldReferences(
    connections: IRConnection[],
    stepMap: Map<string, IRStep>
  ): StructuralError[] {
    const errors: StructuralError[] = [];

    for (const conn of connections) {
      const fromStep = stepMap.get(conn.from_step);
      const toStep = stepMap.get(conn.to_step);

      // Skip if either step is missing (already reported in checkConnectionValidity)
      if (!fromStep || !toStep) continue;

      // Validate from_output against upstream output_schema
      const outputProps = fromStep.output_schema?.properties;
      if (outputProps && Object.keys(outputProps).length > 0) {
        if (!(conn.from_output in outputProps)) {
          errors.push(
            this.makeError(
              conn.from_step,
              'UNDEFINED_FIELD_REFERENCE',
              `Step '${conn.from_step}' does not produce output field '${conn.from_output}'. ` +
                `Available output fields: ${Object.keys(outputProps).join(', ')}.`,
              { step: conn.from_step, parameter: conn.from_output }
            )
          );
        }
      }

      // Validate to_input against downstream input_schema
      const inputProps = toStep.input_schema?.properties;
      if (inputProps && Object.keys(inputProps).length > 0) {
        if (!(conn.to_input in inputProps)) {
          errors.push(
            this.makeError(
              conn.to_step,
              'UNDEFINED_FIELD_REFERENCE',
              `Step '${conn.to_step}' does not accept input field '${conn.to_input}'. ` +
                `Available input fields: ${Object.keys(inputProps).join(', ')}.`,
              { step: conn.to_step, parameter: conn.to_input }
            )
          );
        }
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build a Map from step.id → IRStep for O(1) lookups. */
  private buildStepMap(steps: IRStep[]): Map<string, IRStep> {
    const map = new Map<string, IRStep>();
    for (const step of steps) {
      map.set(step.id, step);
    }
    return map;
  }

  /** Construct a StructuralError object. */
  private makeError(
    stepId: string,
    errorType: StructuralErrorType,
    message: string,
    location: { step: string; parameter?: string }
  ): StructuralError {
    return { step_id: stepId, error_type: errorType, message, location };
  }

  /**
   * Check whether a runtime value is compatible with a declared ParameterType.
   *
   * Rules:
   *  - 'any'      → always compatible
   *  - 'string'   → typeof value === 'string'
   *  - 'number'   → typeof value === 'number'
   *  - 'boolean'  → typeof value === 'boolean'
   *  - 'string[]' → Array.isArray && every element is a string
   *  - 'number[]' → Array.isArray && every element is a number
   *  - 'object'   → typeof value === 'object' && value !== null && !Array.isArray
   *  - 'object[]' → Array.isArray && every element is a non-null object
   */
  private isCompatibleType(value: unknown, expected: ParameterType): boolean {
    switch (expected) {
      case 'any':
        return true;

      case 'string':
        return typeof value === 'string';

      case 'number':
        return typeof value === 'number';

      case 'boolean':
        return typeof value === 'boolean';

      case 'string[]':
        return Array.isArray(value) && (value as unknown[]).every(v => typeof v === 'string');

      case 'number[]':
        return Array.isArray(value) && (value as unknown[]).every(v => typeof v === 'number');

      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);

      case 'object[]':
        return (
          Array.isArray(value) &&
          (value as unknown[]).every(v => typeof v === 'object' && v !== null && !Array.isArray(v))
        );

      default:
        // Unknown expected type — treat as compatible to avoid false positives
        return true;
    }
  }

  /** Return a human-readable description of a value's runtime type. */
  private describeValueType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
      if (value.length === 0) return 'empty array';
      const elemType = typeof value[0];
      return `${elemType}[] (array)`;
    }
    return typeof value;
  }
}
