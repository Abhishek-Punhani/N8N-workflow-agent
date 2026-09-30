/**
 * AI Data Intelligence Platform - DataContractValidator Property Tests
 *
 * Task 7.2 — Properties 24-26
 *
 * Property 24: Schema Compatibility — valid upstream → downstream passes
 * Property 25: Contract Error Field Specification — errors have non-empty field + message
 * Property 26: IR Field Mapping Completeness — full mappings eliminate UNMAPPED_FIELD errors
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.5
 */

import * as fc from 'fast-check';
import type { IR, IRStep, IRConnection, FieldMapping, JSONSchema } from '../core/types.js';
import { DataContractValidator } from './data-contract-validator.js';

// ============================================================================
// Helpers
// ============================================================================

const validator = new DataContractValidator();

/** Build a minimal IRMetadata. */
const METADATA = {
  objective_hash: 'test-hash',
  created_at: new Date().toISOString(),
  planner_version: '1.0.0',
};

/** Build a JSONSchema with given required fields as string type. */
function schemaWith(fields: string[]): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  for (const f of fields) {
    properties[f] = { type: 'string' };
  }
  return { type: 'object', properties, required: [...fields] };
}

/** Build an IRStep with the given input/output schemas. */
function makeStep(id: string, inputFields: string[], outputFields: string[]): IRStep {
  return {
    id,
    type: 'Extract',
    parameters: {},
    input_schema: schemaWith(inputFields),
    output_schema: schemaWith(outputFields),
  };
}

/** Build field_mappings that cover all required downstream fields from the given source step. */
function makeMappings(fromStep: string, fields: string[]): FieldMapping[] {
  return fields.map(f => ({
    target_field: f,
    source_step: fromStep,
    source_field: f,
  }));
}

// ============================================================================
// Arbitraries
// ============================================================================

const arbFieldName = fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z_][a-z0-9_]*$/.test(s) && s !== '__proto__');
const arbFieldSet = fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 });

// ============================================================================
// Property 24: Schema Compatibility
// ============================================================================

describe('Property 24: Schema Compatibility — upstream superset of downstream required fields → valid', () => {
  it('validate() returns valid=true when upstream output contains all required downstream fields', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        fc.uniqueArray(arbFieldName, { minLength: 0, maxLength: 3 }),
        (requiredFields, extraUpstreamFields) => {
          // Upstream produces: requiredFields + extras
          const upstreamFields = [...new Set([...requiredFields, ...extraUpstreamFields])];
          const upstream = makeStep('step-a', [], upstreamFields);
          const downstream = makeStep('step-b', requiredFields, []);

          const connection: IRConnection = {
            from_step: 'step-a',
            from_output: 'output',
            to_step: 'step-b',
            to_input: 'input',
          };

          // Provide explicit field_mappings to avoid UNMAPPED_FIELD errors
          const mappings = makeMappings('step-a', requiredFields);

          const ir: IR = {
            steps: [upstream, downstream],
            connections: [connection],
            field_mappings: mappings,
            metadata: METADATA,
          };

          const result = validator.validate(ir);
          expect(result.valid).toBe(true);
          expect(result.errors.filter(e => e.error_type === 'MISSING_FIELD')).toHaveLength(0);
          expect(result.errors.filter(e => e.error_type === 'TYPE_MISMATCH')).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validate() returns MISSING_FIELD errors when required downstream fields absent from upstream', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        arbFieldSet,
        (upstreamFields, missingFields) => {
          // Ensure the missing fields don't overlap with upstream
          const trulyMissing = missingFields.filter(f => !upstreamFields.includes(f));
          fc.pre(trulyMissing.length > 0);

          const upstream = makeStep('step-a', [], upstreamFields);
          const downstream = makeStep('step-b', trulyMissing, []);

          const ir: IR = {
            steps: [upstream, downstream],
            connections: [{
              from_step: 'step-a',
              from_output: 'output',
              to_step: 'step-b',
              to_input: 'input',
            }],
            field_mappings: [],
            metadata: METADATA,
          };

          const result = validator.validate(ir);
          expect(result.valid).toBe(false);
          const missingFieldErrors = result.errors.filter(e => e.error_type === 'MISSING_FIELD');
          expect(missingFieldErrors.length).toBeGreaterThanOrEqual(trulyMissing.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 25: Contract Error Field Specification
// ============================================================================

describe('Property 25: Contract Error Field Specification — every error has non-empty field + message', () => {
  it('all errors from validate() have non-empty field and message strings', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        arbFieldSet,
        (upstreamFields, requiredDownstreamFields) => {
          const upstream = makeStep('step-a', [], upstreamFields);
          const downstream = makeStep('step-b', requiredDownstreamFields, []);

          const ir: IR = {
            steps: [upstream, downstream],
            connections: [{
              from_step: 'step-a',
              from_output: 'output',
              to_step: 'step-b',
              to_input: 'input',
            }],
            field_mappings: [],
            metadata: METADATA,
          };

          const result = validator.validate(ir);

          for (const error of result.errors) {
            expect(typeof error.field).toBe('string');
            expect(error.field.length).toBeGreaterThan(0);

            expect(typeof error.message).toBe('string');
            expect(error.message.length).toBeGreaterThan(0);

            // from_step and to_step must also be non-empty
            expect(error.from_step.length).toBeGreaterThan(0);
            expect(error.to_step.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validateConnection() direct call — all errors have non-empty field and message', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        arbFieldSet,
        (upstreamFields, requiredFields) => {
          const upstream = schemaWith(upstreamFields);
          const downstream = schemaWith(requiredFields);

          const errors = validator.validateConnection(upstream, downstream, []);

          for (const error of errors) {
            expect(error.field.length).toBeGreaterThan(0);
            expect(error.message.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 26: IR Field Mapping Completeness
// ============================================================================

describe('Property 26: IR Field Mapping Completeness — full coverage eliminates UNMAPPED_FIELD', () => {
  it('no UNMAPPED_FIELD errors when explicit mappings cover all required downstream fields', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        (requiredFields) => {
          const upstream = makeStep('step-a', [], requiredFields);
          const downstream = makeStep('step-b', requiredFields, []);

          // Provide complete coverage
          const mappings = makeMappings('step-a', requiredFields);

          const ir: IR = {
            steps: [upstream, downstream],
            connections: [{
              from_step: 'step-a',
              from_output: 'output',
              to_step: 'step-b',
              to_input: 'input',
            }],
            field_mappings: mappings,
            metadata: METADATA,
          };

          const result = validator.validate(ir);
          const unmappedErrors = result.errors.filter(e => e.error_type === 'UNMAPPED_FIELD');
          expect(unmappedErrors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('UNMAPPED_FIELD errors appear for fields without an explicit mapping', () => {
    fc.assert(
      fc.property(
        arbFieldSet,
        (requiredFields) => {
          fc.pre(requiredFields.length > 0);

          const upstream = makeStep('step-a', [], requiredFields);
          const downstream = makeStep('step-b', requiredFields, []);

          // Provide NO mappings
          const ir: IR = {
            steps: [upstream, downstream],
            connections: [{
              from_step: 'step-a',
              from_output: 'output',
              to_step: 'step-b',
              to_input: 'input',
            }],
            field_mappings: [],
            metadata: METADATA,
          };

          const result = validator.validate(ir);
          const unmappedErrors = result.errors.filter(e => e.error_type === 'UNMAPPED_FIELD');
          expect(unmappedErrors.length).toBeGreaterThanOrEqual(requiredFields.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
