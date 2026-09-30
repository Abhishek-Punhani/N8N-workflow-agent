/**
 * AI Data Intelligence Platform - StructuralCheck Property-Based Tests
 *
 * Properties 5-9 as defined in tasks.md §2.2
 * Uses fast-check for property-based testing (100+ iterations per property).
 *
 * Property 5: Step Type Validation   — Accept valid IRs, reject invalid step types
 * Property 6: Parameter Validation   — Accept complete parameters, reject missing/incorrect types
 * Property 7: Field Reference Validation — Accept valid field refs, reject undefined refs
 * Property 8: Error Precision        — Errors include precise step_id and location
 * Property 9: Pass-Through           — Valid IR passes through unchanged
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */

import * as fc from 'fast-check';
import { StructuralCheck } from './structural-check';
import type { IR, IRStep, IRConnection, CapabilityType } from '../core/types';
import { CAPABILITY_VOCABULARY } from '../core/types';

// ============================================================================
// Shared constants
// ============================================================================

const VALID_CAPABILITY_TYPES = Object.keys(CAPABILITY_VOCABULARY) as CapabilityType[];

// ============================================================================
// Arbitraries (fast-check generators)
// ============================================================================

/** A valid non-empty identifier string (no spaces, no dots). */
const arbId = fc.stringMatching(/^[a-z][a-z0-9_]{0,19}$/).filter(s => s.length >= 2);

/** Pick one of the 11 valid capability types. */
const arbValidCapabilityType: fc.Arbitrary<CapabilityType> = fc.constantFrom(
  ...VALID_CAPABILITY_TYPES
);

/** A string that is definitely NOT a valid capability type. */
const arbInvalidCapabilityType: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => !VALID_CAPABILITY_TYPES.includes(s as CapabilityType));

/**
 * Build a parameters object that satisfies every required parameter for
 * the given capability type with a correctly-typed value.
 */
function buildValidParams(type: CapabilityType): Record<string, unknown> {
  const required = CAPABILITY_VOCABULARY[type].requiredParameters;
  const params: Record<string, unknown> = {};

  for (const [name, paramType] of Object.entries(required)) {
    switch (paramType) {
      case 'string':
        params[name] = 'value';
        break;
      case 'number':
        params[name] = 1;
        break;
      case 'boolean':
        params[name] = true;
        break;
      case 'string[]':
        params[name] = ['value'];
        break;
      case 'number[]':
        params[name] = [1];
        break;
      case 'object':
        params[name] = { key: 'value' };
        break;
      case 'object[]':
        params[name] = [{ key: 'value' }];
        break;
      default:
        params[name] = 'value';
    }
  }
  return params;
}

/** A single valid IRStep for the given capability type (no schema properties → field-ref checks skipped). */
function makeValidStep(id: string, type: CapabilityType): IRStep {
  return {
    id,
    type,
    parameters: buildValidParams(type),
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
  };
}

/** Build a minimal valid IR with `n` steps and no connections. */
const arbValidIR = (minSteps = 1, maxSteps = 5): fc.Arbitrary<IR> =>
  fc
    .uniqueArray(arbId, { minLength: minSteps, maxLength: maxSteps })
    .chain(ids =>
      fc
        .tuple(...ids.map(id => arbValidCapabilityType.map(type => makeValidStep(id, type))))
        .map(steps => ({
          steps,
          connections: [] as IRConnection[],
          field_mappings: [],
          metadata: {
            objective_hash: 'testhash',
            created_at: new Date().toISOString(),
            planner_version: '1.0.0',
          },
        }))
    );

// ============================================================================
// Property 5: Step Type Validation
//
// "Accept valid IRs, reject invalid step types"
// – An IR where every step.type ∈ CAPABILITY_VOCABULARY → status 'valid'
// – An IR containing at least one step.type ∉ CAPABILITY_VOCABULARY → status 'invalid'
//   with at least one INVALID_STEP_TYPE error
// ============================================================================

describe('Property 5: Step Type Validation', () => {
  const checker = new StructuralCheck();

  it('accepts IRs where all step types are in the Capability Vocabulary', () => {
    fc.assert(
      fc.property(arbValidIR(1, 5), ir => {
        const result = checker.validate(ir);
        // There may be other errors (parameter-related) but no INVALID_STEP_TYPE
        const stepTypeErrors = (result.errors ?? []).filter(
          e => e.error_type === 'INVALID_STEP_TYPE'
        );
        expect(stepTypeErrors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects IRs that contain an invalid step type', () => {
    fc.assert(
      fc.property(
        arbId,
        arbInvalidCapabilityType,
        (stepId, badType) => {
          const ir: IR = {
            steps: [
              {
                id: stepId,
                type: badType as CapabilityType,
                parameters: {},
                input_schema: { type: 'object' },
                output_schema: { type: 'object' },
              },
            ],
            connections: [],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          expect(result.status).toBe('invalid');

          const stepTypeErrors = (result.errors ?? []).filter(
            e => e.error_type === 'INVALID_STEP_TYPE'
          );
          expect(stepTypeErrors.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 6: Parameter Validation
//
// "Accept complete parameters, reject missing/incorrect types"
// – A step with all required parameters correctly typed → no parameter errors
// – A step with a required parameter removed → MISSING_PARAMETER error
// – A step with a parameter set to the wrong type → INVALID_PARAMETER_TYPE error
// ============================================================================

describe('Property 6: Parameter Validation', () => {
  const checker = new StructuralCheck();

  it('accepts steps that have all required parameters with correct types', () => {
    fc.assert(
      fc.property(arbValidIR(1, 5), ir => {
        const result = checker.validate(ir);
        const paramErrors = (result.errors ?? []).filter(
          e => e.error_type === 'MISSING_PARAMETER' || e.error_type === 'INVALID_PARAMETER_TYPE'
        );
        expect(paramErrors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects steps that are missing a required parameter', () => {
    // Only test capability types that actually have required parameters
    const typesWithParams = VALID_CAPABILITY_TYPES.filter(
      t => Object.keys(CAPABILITY_VOCABULARY[t].requiredParameters).length > 0
    );

    fc.assert(
      fc.property(
        arbId,
        fc.constantFrom(...typesWithParams),
        (stepId, type) => {
          const requiredParams = CAPABILITY_VOCABULARY[type].requiredParameters;
          const paramNames = Object.keys(requiredParams);
          // Remove the first required parameter to guarantee a MISSING_PARAMETER
          const incompleteParams = buildValidParams(type);
          delete incompleteParams[paramNames[0]];

          const ir: IR = {
            steps: [
              {
                id: stepId,
                type,
                parameters: incompleteParams as Record<string, unknown>,
                input_schema: { type: 'object' },
                output_schema: { type: 'object' },
              },
            ],
            connections: [],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          expect(result.status).toBe('invalid');

          const missingErrors = (result.errors ?? []).filter(
            e => e.error_type === 'MISSING_PARAMETER'
          );
          expect(missingErrors.length).toBeGreaterThanOrEqual(1);
          // The error must reference the removed parameter
          const targetError = missingErrors.find(e => e.location.parameter === paramNames[0]);
          expect(targetError).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects steps where a required parameter has the wrong type', () => {
    // Use 'Acquire' — requires { urls: string[], method: string }
    // Inject a number where a string[] is expected
    fc.assert(
      fc.property(arbId, stepId => {
        const ir: IR = {
          steps: [
            {
              id: stepId,
              type: 'Acquire',
              parameters: {
                urls: 42, // should be string[]
                method: 'GET',
              },
              input_schema: { type: 'object' },
              output_schema: { type: 'object' },
            },
          ],
          connections: [],
          field_mappings: [],
          metadata: {
            objective_hash: 'hash',
            created_at: new Date().toISOString(),
            planner_version: '1.0.0',
          },
        };

        const result = checker.validate(ir);
        expect(result.status).toBe('invalid');

        const typeErrors = (result.errors ?? []).filter(
          e => e.error_type === 'INVALID_PARAMETER_TYPE'
        );
        expect(typeErrors.length).toBeGreaterThanOrEqual(1);
        expect(typeErrors[0].location.parameter).toBe('urls');
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 7: Field Reference Validation
//
// "Accept valid field refs, reject undefined refs"
// – A connection whose from_output is in the upstream step's output_schema.properties
//   and to_input is in the downstream step's input_schema.properties → no field-ref errors
// – A connection whose from_output is NOT in the upstream output_schema → error
// – A connection whose to_input is NOT in the downstream input_schema → error
// ============================================================================

describe('Property 7: Field Reference Validation', () => {
  const checker = new StructuralCheck();

  it('accepts connections where field references exist in the declared schemas', () => {
    fc.assert(
      fc.property(
        arbId,
        arbId.filter(id => id !== 'step1'), // ensure unique IDs
        (id1, id2) => {
          const ir: IR = {
            steps: [
              {
                id: id1,
                type: 'Acquire',
                parameters: buildValidParams('Acquire'),
                input_schema: { type: 'object', properties: {} },
                output_schema: { type: 'object', properties: { contents: { type: 'array' } } },
              },
              {
                id: id2,
                type: 'Extract',
                parameters: buildValidParams('Extract'),
                input_schema: { type: 'object', properties: { contents: { type: 'array' } } },
                output_schema: { type: 'object', properties: { records: { type: 'array' } } },
              },
            ],
            connections: [
              {
                from_step: id1,
                from_output: 'contents', // exists in id1 output_schema
                to_step: id2,
                to_input: 'contents', // exists in id2 input_schema
              },
            ],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          const fieldRefErrors = (result.errors ?? []).filter(
            e => e.error_type === 'UNDEFINED_FIELD_REFERENCE'
          );
          expect(fieldRefErrors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects connections where from_output does not exist in upstream output_schema', () => {
    fc.assert(
      fc.property(
        arbId,
        arbId,
        // A field name that is definitely not 'contents'
        fc.string({ minLength: 1, maxLength: 15 }).filter(f => f !== 'contents'),
        (id1, id2, badField) => {
          // Ensure the two step IDs are distinct so the connection is between different steps
          fc.pre(id1 !== id2);
          const ir: IR = {
            steps: [
              {
                id: id1,
                type: 'Acquire',
                parameters: buildValidParams('Acquire'),
                input_schema: { type: 'object', properties: {} },
                output_schema: { type: 'object', properties: { contents: { type: 'array' } } },
              },
              {
                id: id2,
                type: 'Extract',
                parameters: buildValidParams('Extract'),
                input_schema: { type: 'object', properties: { contents: { type: 'array' } } },
                output_schema: { type: 'object', properties: {} },
              },
            ],
            connections: [
              {
                from_step: id1,
                from_output: badField, // NOT in output_schema
                to_step: id2,
                to_input: 'contents',
              },
            ],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          const fieldRefErrors = (result.errors ?? []).filter(
            e => e.error_type === 'UNDEFINED_FIELD_REFERENCE'
          );
          expect(fieldRefErrors.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects connections that reference a non-existent step ID', () => {
    fc.assert(
      fc.property(arbId, stepId => {
        const ir: IR = {
          steps: [
            {
              id: stepId,
              type: 'Acquire',
              parameters: buildValidParams('Acquire'),
              input_schema: { type: 'object' },
              output_schema: { type: 'object' },
            },
          ],
          connections: [
            {
              from_step: stepId,
              from_output: 'contents',
              to_step: 'ghost_step_that_does_not_exist',
              to_input: 'data',
            },
          ],
          field_mappings: [],
          metadata: {
            objective_hash: 'hash',
            created_at: new Date().toISOString(),
            planner_version: '1.0.0',
          },
        };

        const result = checker.validate(ir);
        expect(result.status).toBe('invalid');
        const fieldRefErrors = (result.errors ?? []).filter(
          e => e.error_type === 'UNDEFINED_FIELD_REFERENCE'
        );
        expect(fieldRefErrors.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 8: Error Precision
//
// "Errors include precise step_id and location"
// – Every StructuralError returned must have:
//     • step_id      : non-empty string
//     • error_type   : one of the 4 known types
//     • message      : non-empty string
//     • location.step: non-empty string that equals step_id
// ============================================================================

describe('Property 8: Error Precision', () => {
  const checker = new StructuralCheck();

  const KNOWN_ERROR_TYPES = [
    'INVALID_STEP_TYPE',
    'MISSING_PARAMETER',
    'INVALID_PARAMETER_TYPE',
    'UNDEFINED_FIELD_REFERENCE',
  ] as const;

  it('every error has a non-empty step_id, known error_type, non-empty message, and matching location.step', () => {
    // Generate IRs with at least one invalid step type to guarantee errors
    fc.assert(
      fc.property(
        arbId,
        arbInvalidCapabilityType,
        (stepId, badType) => {
          const ir: IR = {
            steps: [
              {
                id: stepId,
                type: badType as CapabilityType,
                parameters: {},
                input_schema: { type: 'object' },
                output_schema: { type: 'object' },
              },
            ],
            connections: [],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          expect(result.status).toBe('invalid');
          expect(result.errors).toBeDefined();
          expect(result.errors!.length).toBeGreaterThan(0);

          for (const err of result.errors!) {
            // step_id must be a non-empty string
            expect(typeof err.step_id).toBe('string');
            expect(err.step_id.length).toBeGreaterThan(0);

            // error_type must be one of the 4 known values
            expect(KNOWN_ERROR_TYPES).toContain(err.error_type);

            // message must be a non-empty string
            expect(typeof err.message).toBe('string');
            expect(err.message.length).toBeGreaterThan(0);

            // location.step must equal step_id
            expect(err.location).toBeDefined();
            expect(typeof err.location.step).toBe('string');
            expect(err.location.step).toBe(err.step_id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('parameter errors carry the parameter name in location.parameter', () => {
    const typesWithParams = VALID_CAPABILITY_TYPES.filter(
      t => Object.keys(CAPABILITY_VOCABULARY[t].requiredParameters).length > 0
    );

    fc.assert(
      fc.property(
        arbId,
        fc.constantFrom(...typesWithParams),
        (stepId, type) => {
          const requiredParams = CAPABILITY_VOCABULARY[type].requiredParameters;
          const firstParam = Object.keys(requiredParams)[0];

          const incompleteParams = buildValidParams(type);
          delete incompleteParams[firstParam];

          const ir: IR = {
            steps: [
              {
                id: stepId,
                type,
                parameters: incompleteParams as Record<string, unknown>,
                input_schema: { type: 'object' },
                output_schema: { type: 'object' },
              },
            ],
            connections: [],
            field_mappings: [],
            metadata: {
              objective_hash: 'hash',
              created_at: new Date().toISOString(),
              planner_version: '1.0.0',
            },
          };

          const result = checker.validate(ir);
          const missingErr = (result.errors ?? []).find(
            e => e.error_type === 'MISSING_PARAMETER' && e.location.parameter === firstParam
          );

          expect(missingErr).toBeDefined();
          expect(missingErr!.location.parameter).toBe(firstParam);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 9: Pass-Through
//
// "Valid IR passes through unchanged"
// – For any IR that passes all structural checks:
//     • result.status === 'valid'
//     • result.verified_ir.ir is deeply equal to the original IR
//     • result.verified_ir.validated_at is a valid ISO date string
//     • result.errors is undefined (no errors on a valid IR)
// ============================================================================

describe('Property 9: Pass-Through', () => {
  const checker = new StructuralCheck();

  it('returns the original IR unchanged inside VerifiedIR when the IR is valid', () => {
    fc.assert(
      fc.property(arbValidIR(1, 5), ir => {
        const result = checker.validate(ir);

        expect(result.status).toBe('valid');
        expect(result.errors).toBeUndefined();
        expect(result.verified_ir).toBeDefined();

        // The wrapped IR must be deeply equal to the input
        expect(result.verified_ir!.ir).toEqual(ir);

        // validated_at must be a valid ISO 8601 date string
        const parsedDate = new Date(result.verified_ir!.validated_at);
        expect(parsedDate.toString()).not.toBe('Invalid Date');

        // validator_version must be a non-empty string
        expect(typeof result.verified_ir!.validator_version).toBe('string');
        expect(result.verified_ir!.validator_version.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('does NOT mutate the original IR object during validation', () => {
    fc.assert(
      fc.property(arbValidIR(1, 5), ir => {
        // Deep-clone the IR before validation
        const irCopy = JSON.parse(JSON.stringify(ir)) as IR;

        checker.validate(ir);

        // The original IR must be unchanged
        expect(ir).toEqual(irCopy);
      }),
      { numRuns: 100 }
    );
  });
});
