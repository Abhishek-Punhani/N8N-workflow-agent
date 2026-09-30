/**
 * AI Data Intelligence Platform - ContractCheck Property-Based Tests
 *
 * Properties 14-16 as defined in tasks.md §2.8
 * Uses fast-check for property-based testing (100+ iterations per property).
 *
 * Property 14: Set Difference         — Correctly compute missing fields,
 *                                       return empty set when all fields present
 * Property 15: Provenance Verification — source_url enforced when required,
 *                                        passes when already present
 * Property 16: Certificate Completeness — All satisfied fields listed in certificate
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6
 */

import * as fc from 'fast-check';
import { ContractCheck } from './contract-check.js';
import type { ContractCheckInput } from './contract-check.js';
import type { N8NWorkflow, N8NNode, FieldDefinition, FieldDefinitionType } from '../core/types.js';

// ============================================================================
// Shared constants
// ============================================================================

const DELIVER_NODE_TYPE = 'n8n-nodes-base.Webhook';

const FIELD_TYPES: FieldDefinitionType[] = [
  'string',
  'number',
  'date',
  'url',
  'email',
  'array',
  'object',
];

// ============================================================================
// Arbitraries
// ============================================================================

/** A valid non-empty field name (alphanumeric + underscore, starts with letter). */
const arbFieldName: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,19}$/)
  .filter(s => s.length >= 2 && s !== 'source_url');

/** A valid FieldDefinitionType. */
const arbFieldType: fc.Arbitrary<FieldDefinitionType> = fc.constantFrom(...FIELD_TYPES);

/** A FieldDefinition with a controlled name (not source_url — handled separately). */
const arbFieldDef = (name: string): FieldDefinition => ({
  name,
  type: 'string',
  required: true,
});

/** Build a minimal Deliver node that explicitly declares a set of field names. */
function makeDeliverNode(fieldNames: string[]): N8NNode {
  // Expose fields via the "fields" parameter (array of { name } objects)
  // so collectProducedFields() picks them up via the (b) path.
  return {
    id: 'deliver-node',
    name: 'Deliver-deliver-node',
    type: DELIVER_NODE_TYPE,
    typeVersion: 1,
    position: [400, 100],
    parameters: {
      httpMethod: 'GET',
      responseMode: 'lastNode',
      fields: fieldNames.map(n => ({ name: n })),
    },
  };
}

/** Build a minimal workflow containing exactly the given nodes. */
function makeWorkflow(nodes: N8NNode[]): N8NWorkflow {
  return {
    name: 'Test Workflow',
    nodes,
    connections: {},
    settings: {},
    staticData: { version: 1 },
  };
}

/** Build a ContractCheckInput. */
function makeInput(
  workflow: N8NWorkflow,
  required_fields: FieldDefinition[],
  provenance_required = false
): ContractCheckInput {
  return { workflow_json: workflow, required_fields, provenance_required };
}

// ============================================================================
// Property 14: Set Difference
//
// "Correctly compute missing fields, return empty set when complete"
//
// Sub-properties:
//  14a. When the Deliver node produces ALL required fields →
//       status === 'certified', no violations.
//  14b. When at least one required field is absent from the Deliver node →
//       status === 'violation', violations contain exactly that field.
//  14c. The set of missing fields equals required_fields − produced_fields
//       (mathematical set difference).
// ============================================================================

describe('Property 14: Set Difference', () => {
  const checker = new ContractCheck();

  it('certifies when the workflow produces all required fields', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 8 }), fieldNames => {
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);
        const result = checker.verify(makeInput(workflow, required));

        expect(result.status).toBe('certified');
        expect(result.violations).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('returns violation when a required field is absent', () => {
    fc.assert(
      fc.property(
        // produced: 1–5 fields; required: produced + 1 extra missing field
        fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }),
        arbFieldName,
        (producedNames, missingName) => {
          fc.pre(!producedNames.includes(missingName));

          const deliverNode = makeDeliverNode(producedNames);
          const workflow = makeWorkflow([deliverNode]);
          const required = [...producedNames, missingName].map(arbFieldDef);

          const result = checker.verify(makeInput(workflow, required));

          expect(result.status).toBe('violation');
          expect(result.violations).toBeDefined();

          const missingEntry = result.violations!.find(v => v.missing_field === missingName);
          expect(missingEntry).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the violation list is exactly required_fields − produced_fields', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbFieldName, { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 1, max: 3 }),
        (allNames, missingCount) => {
          fc.pre(missingCount < allNames.length);

          const missingNames = allNames.slice(0, missingCount);
          const producedNames = allNames.slice(missingCount);

          const deliverNode = makeDeliverNode(producedNames);
          const workflow = makeWorkflow([deliverNode]);
          const required = allNames.map(arbFieldDef);

          const result = checker.verify(makeInput(workflow, required));

          expect(result.status).toBe('violation');

          const violatedFieldNames = result.violations!.map(v => v.missing_field);
          for (const name of missingNames) {
            expect(violatedFieldNames).toContain(name);
          }
          // Produced fields must NOT appear in violations
          for (const name of producedNames) {
            expect(violatedFieldNames).not.toContain(name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('certifies with empty required_fields (vacuously complete)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 0, maxLength: 5 }), producedNames => {
        const workflow = makeWorkflow([makeDeliverNode(producedNames)]);
        const result = checker.verify(makeInput(workflow, []));

        expect(result.status).toBe('certified');
      }),
      { numRuns: 100 }
    );
  });

  it('each violation carries the expected_type from the FieldDefinition', () => {
    fc.assert(
      fc.property(arbFieldName, arbFieldType, (fieldName, fieldType) => {
        // Empty Deliver node → field is definitely missing
        const deliverNode = makeDeliverNode([]);
        const workflow = makeWorkflow([deliverNode]);
        const required: FieldDefinition[] = [{ name: fieldName, type: fieldType, required: true }];

        const result = checker.verify(makeInput(workflow, required, false));

        expect(result.status).toBe('violation');
        const violation = result.violations!.find(v => v.missing_field === fieldName);
        expect(violation).toBeDefined();
        expect(violation!.expected_type).toBe(fieldType);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 15: Provenance Verification
//
// "Verify source_url presence when provenance required"
//
// Sub-properties:
//  15a. When provenance_required is true and source_url IS produced →
//       no provenance violation is added.
//  15b. When provenance_required is true and source_url is NOT produced →
//       a violation with missing_field === 'source_url' and
//       required_by === 'provenance_requirement' is returned.
//  15c. When provenance_required is false, source_url absence causes no violation.
// ============================================================================

describe('Property 15: Provenance Verification', () => {
  const checker = new ContractCheck();

  it('no provenance violation when source_url is produced and provenance is required', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 0, maxLength: 5 }), otherFields => {
        // Include source_url in the Deliver node's output
        const allProduced = [...otherFields, 'source_url'];
        const deliverNode = makeDeliverNode(allProduced);
        const workflow = makeWorkflow([deliverNode]);

        // required_fields only asks for the other fields (no source_url in list)
        const required = otherFields.map(arbFieldDef);
        const result = checker.verify(makeInput(workflow, required, true));

        const provenanceViolation = (result.violations ?? []).find(
          v => v.missing_field === 'source_url'
        );
        expect(provenanceViolation).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('adds source_url violation when provenance is required but source_url is absent', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }), fieldNames => {
        // Deliver node does NOT produce source_url
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required, true));

        expect(result.status).toBe('violation');
        const provenanceViolation = result.violations!.find(v => v.missing_field === 'source_url');
        expect(provenanceViolation).toBeDefined();
        expect(provenanceViolation!.required_by).toBe('provenance_requirement');
        expect(provenanceViolation!.expected_type).toBe('url');
      }),
      { numRuns: 100 }
    );
  });

  it('no provenance violation when provenance_required is false, even without source_url', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }), fieldNames => {
        // Deliver node does NOT produce source_url, but provenance_required=false
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required, false));

        const provenanceViolation = (result.violations ?? []).find(
          v => v.missing_field === 'source_url'
        );
        expect(provenanceViolation).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('certifies with provenance when source_url produced and all fields satisfied', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }), fieldNames => {
        const allProduced = [...fieldNames, 'source_url'];
        const deliverNode = makeDeliverNode(allProduced);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required, true));

        expect(result.status).toBe('certified');
        expect(result.certificate).toBeDefined();
        expect(result.certificate!.provenance_verified).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 16: Certificate Completeness
//
// "List all satisfied fields in certificate"
//
// Sub-properties:
//  16a. certificate.satisfied_fields contains every name from required_fields.
//  16b. No required field name is omitted from satisfied_fields.
//  16c. certificate.satisfied_required_fields equals the full required_fields array.
//  16d. certificate.certification_timestamp is a valid ISO 8601 date.
//  16e. result.checked_at is a valid ISO 8601 date on both certified and violation.
// ============================================================================

describe('Property 16: Certificate Completeness', () => {
  const checker = new ContractCheck();

  it('satisfied_fields contains every required field name', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 8 }), fieldNames => {
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required));

        expect(result.status).toBe('certified');
        const cert = result.certificate!;

        for (const name of fieldNames) {
          expect(cert.satisfied_fields).toContain(name);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('no required field name is omitted from satisfied_fields', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 8 }), fieldNames => {
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required));

        expect(result.status).toBe('certified');
        // satisfied_fields length must equal required fields count
        // (no duplicates, no omissions)
        expect(result.certificate!.satisfied_fields.length).toBe(fieldNames.length);
      }),
      { numRuns: 100 }
    );
  });

  it('satisfied_required_fields equals the full required_fields array', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 6 }),
        arbFieldType,
        (fieldNames, fieldType) => {
          const required: FieldDefinition[] = fieldNames.map(n => ({
            name: n,
            type: fieldType,
            required: true,
          }));
          const deliverNode = makeDeliverNode(fieldNames);
          const workflow = makeWorkflow([deliverNode]);

          const result = checker.verify(makeInput(workflow, required));

          expect(result.status).toBe('certified');
          expect(result.certificate!.satisfied_required_fields).toEqual(required);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('certification_timestamp is a valid ISO 8601 date string', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }), fieldNames => {
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required));

        expect(result.status).toBe('certified');
        const ts = result.certificate!.certification_timestamp;
        expect(typeof ts).toBe('string');
        expect(isNaN(new Date(ts).getTime())).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('checked_at is a valid ISO 8601 date on both certified and violation results', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        (fieldNames, allPresent) => {
          const producedNames = allPresent ? fieldNames : fieldNames.slice(1);
          const deliverNode = makeDeliverNode(producedNames);
          const workflow = makeWorkflow([deliverNode]);
          const required = fieldNames.map(arbFieldDef);

          const result = checker.verify(makeInput(workflow, required));

          expect(typeof result.checked_at).toBe('string');
          expect(isNaN(new Date(result.checked_at).getTime())).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('certificate contains a non-empty validator_version string', () => {
    fc.assert(
      fc.property(fc.uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 }), fieldNames => {
        const deliverNode = makeDeliverNode(fieldNames);
        const workflow = makeWorkflow([deliverNode]);
        const required = fieldNames.map(arbFieldDef);

        const result = checker.verify(makeInput(workflow, required));

        expect(result.status).toBe('certified');
        expect(typeof result.certificate!.validator_version).toBe('string');
        expect(result.certificate!.validator_version.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
