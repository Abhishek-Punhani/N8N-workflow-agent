/**
 * AI Data Intelligence Platform - JSON Schema Definitions
 *
 * These schemas are used for RUNTIME validation of data from external sources:
 * - API requests
 * - LLM outputs (Intake Agent, Workflow Planner)
 * - User input
 * - n8n webhook payloads
 *
 * Why JSON Schema?
 * - TypeScript only validates at compile-time
 * - We need runtime validation for untrusted data
 * - Used with 'ajv' validator library
 *
 * Based on JSON Schema Draft-07
 */

// ============================================================================
// UserPrompt Schema
// ============================================================================

export const UserPromptSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  // $id removed - not needed for validation, only for external referencing
  type: 'object',
  required: ['id', 'prompt', 'created_at', 'status'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    prompt: {
      type: 'string',
      minLength: 1,
      maxLength: 10000,
    },
    created_at: {
      type: 'string',
      format: 'date-time',
    },
    status: {
      type: 'string',
      enum: ['pending', 'planning', 'verifying', 'running', 'completed', 'failed'],
    },
  },
  additionalProperties: false,
} as const;

export type UserPromptSchemaType = typeof UserPromptSchema;

// ============================================================================
// Constraint Schema
// ============================================================================

export const ConstraintSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/Constraint.json',
  type: 'object',
  required: ['field', 'operator', 'value'],
  properties: {
    field: {
      type: 'string',
    },
    operator: {
      type: 'string',
      enum: ['equals', 'contains', 'greater_than', 'less_than', 'between', 'in'],
    },
    value: {
      // value can be any type depending on the field and operator
    },
    source: {
      type: 'string',
    },
  },
  additionalProperties: false,
} as const;

export type ConstraintSchemaType = typeof ConstraintSchema;

// ============================================================================
// FieldDefinition Schema
// ============================================================================

export const FieldDefinitionSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/FieldDefinition.json',
  type: 'object',
  required: ['name', 'type', 'required'],
  properties: {
    name: {
      type: 'string',
    },
    type: {
      type: 'string',
      enum: ['string', 'number', 'date', 'url', 'email', 'array', 'object'],
    },
    required: {
      type: 'boolean',
    },
    description: {
      type: 'string',
    },
  },
  additionalProperties: false,
} as const;

export type FieldDefinitionSchemaType = typeof FieldDefinitionSchema;

// ============================================================================
// DataSourceHint Schema
// ============================================================================

export const DataSourceHintSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/DataSourceHint.json',
  type: 'object',
  properties: {
    type: {
      type: 'string',
    },
    hint: {
      type: 'string',
    },
  },
  additionalProperties: false,
} as const;

export type DataSourceHintSchemaType = typeof DataSourceHintSchema;

// ============================================================================
// OutputRequirements Schema
// ============================================================================

export const OutputRequirementsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/OutputRequirements.json',
  type: 'object',
  properties: {
    format: {
      type: 'string',
      enum: ['csv', 'json'],
    },
    max_records: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000,
    },
  },
  additionalProperties: false,
} as const;

export type OutputRequirementsSchemaType = typeof OutputRequirementsSchema;

// ============================================================================
// StructuredObjective Schema
// ============================================================================

export const StructuredObjectiveSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/StructuredObjective.json',
  type: 'object',
  required: ['target_entity', 'constraints', 'required_fields'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    target_entity: {
      type: 'string',
    },
    constraints: {
      type: 'array',
      items: ConstraintSchema,
    },
    required_fields: {
      type: 'array',
      items: FieldDefinitionSchema,
    },
    data_sources: {
      type: 'array',
      items: DataSourceHintSchema,
    },
    output_requirements: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['csv', 'json'] },
        max_records: { type: 'integer', minimum: 1, maximum: 1000000 },
      },
    },
  },
  additionalProperties: false,
} as const;

export type StructuredObjectiveSchemaType = typeof StructuredObjectiveSchema;

// ============================================================================
// IRStep Schema
// ============================================================================

export const IRStepSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/IRStep.json',
  type: 'object',
  required: ['id', 'type', 'parameters', 'input_schema', 'output_schema'],
  properties: {
    id: {
      type: 'string',
    },
    type: {
      type: 'string',
      enum: [
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
        'Deliver',
      ],
    },
    parameters: {
      type: 'object',
    },
    input_schema: {
      $ref: '#/$defs/schema',
    },
    output_schema: {
      $ref: '#/$defs/schema',
    },
    position: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  additionalProperties: false,
} as const;

export type IRStepSchemaType = typeof IRStepSchema;

// ============================================================================
// IRConnection Schema
// ============================================================================

export const IRConnectionSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/IRConnection.json',
  type: 'object',
  required: ['from_step', 'from_output', 'to_step', 'to_input'],
  properties: {
    from_step: {
      type: 'string',
    },
    from_output: {
      type: 'string',
    },
    to_step: {
      type: 'string',
    },
    to_input: {
      type: 'string',
    },
  },
  additionalProperties: false,
} as const;

export type IRConnectionSchemaType = typeof IRConnectionSchema;

// ============================================================================
// FieldMapping Schema
// ============================================================================

export const FieldMappingSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/FieldMapping.json',
  type: 'object',
  required: ['target_field', 'source_step', 'source_field'],
  properties: {
    target_field: {
      type: 'string',
    },
    source_step: {
      type: 'string',
    },
    source_field: {
      type: 'string',
    },
    transformation: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        parameters: { type: 'object' },
      },
    },
  },
  additionalProperties: false,
} as const;

export type FieldMappingSchemaType = typeof FieldMappingSchema;

// ============================================================================
// IRMetadata Schema
// ============================================================================

export const IRMetadataSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/IRMetadata.json',
  type: 'object',
  required: ['objective_hash', 'created_at', 'planner_version'],
  properties: {
    objective_hash: {
      type: 'string',
    },
    created_at: {
      type: 'string',
      format: 'date-time',
    },
    planner_version: {
      type: 'string',
    },
  },
  additionalProperties: false,
} as const;

export type IRMetadataSchemaType = typeof IRMetadataSchema;

// ============================================================================
// IR (Intermediate Representation) Schema
// ============================================================================

export const IRSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/IR.json',
  type: 'object',
  required: ['steps', 'connections', 'field_mappings', 'metadata'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    steps: {
      type: 'array',
      items: IRStepSchema,
    },
    connections: {
      type: 'array',
      items: IRConnectionSchema,
    },
    field_mappings: {
      type: 'array',
      items: FieldMappingSchema,
    },
    metadata: {
      type: 'object',
      properties: {
        objective_hash: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' },
        planner_version: { type: 'string' },
      },
    },
  },
  additionalProperties: false,
  $defs: {
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        properties: { type: 'object' },
        items: {
          anyOf: [{ $ref: '#/$defs/schema' }, { type: 'array', items: { $ref: '#/$defs/schema' } }],
        },
        required: { type: 'array', items: { type: 'string' } },
        enum: { type: 'array' },
        minLength: { type: 'number' },
        maxLength: { type: 'number' },
        minimum: { type: 'number' },
        maximum: { type: 'number' },
        format: { type: 'string' },
      },
    },
  },
} as const;

export type IRSchemaType = typeof IRSchema;

// ============================================================================
// ProvenanceMetadata Schema
// ============================================================================

export const ProvenanceMetadataSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/ProvenanceMetadata.json',
  type: 'object',
  required: ['source_url', 'extraction_confidence', 'dedupe_group', 'validation_status'],
  properties: {
    source_url: {
      type: ['string', 'null'],
      format: 'uri',
    },
    extraction_confidence: {
      type: 'number',
      minimum: 0.0,
      maximum: 1.0,
    },
    dedupe_group: {
      type: 'string',
    },
    validation_status: {
      type: 'string',
      enum: [
        'valid',
        'invalid:missing_field',
        'invalid:type_mismatch',
        'invalid:constraint_violation',
      ],
    },
  },
  additionalProperties: false,
} as const;

export type ProvenanceMetadataSchemaType = typeof ProvenanceMetadataSchema;

// ============================================================================
// Validation Error Schemas
// ============================================================================

export const StructuralErrorSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/StructuralError.json',
  type: 'object',
  required: ['step_id', 'error_type', 'message', 'location'],
  properties: {
    step_id: {
      type: 'string',
    },
    error_type: {
      type: 'string',
      enum: [
        'INVALID_STEP_TYPE',
        'MISSING_PARAMETER',
        'INVALID_PARAMETER_TYPE',
        'UNDEFINED_FIELD_REFERENCE',
      ],
    },
    message: {
      type: 'string',
    },
    location: {
      type: 'object',
      required: ['step'],
      properties: {
        step: { type: 'string' },
        parameter: { type: 'string' },
      },
    },
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Failure Trace Schema
// ============================================================================

export const FailureTraceSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-data-platform.com/schemas/FailureTrace.json',
  type: 'object',
  required: ['step_id', 'error_message', 'timestamp', 'classification', 'retry_count'],
  properties: {
    step_id: {
      type: 'string',
    },
    error_message: {
      type: 'string',
    },
    stack_trace: {
      type: 'string',
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
    },
    classification: {
      type: 'string',
      enum: ['LOGIC_FAILURE', 'INFRASTRUCTURE_FAILURE', 'EXTERNAL_SOURCE_UNAVAILABLE'],
    },
    retry_count: {
      type: 'integer',
      minimum: 0,
    },
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Export schemas for external use
// ============================================================================

export const Schemas = {
  UserPrompt: UserPromptSchema,
  Constraint: ConstraintSchema,
  FieldDefinition: FieldDefinitionSchema,
  DataSourceHint: DataSourceHintSchema,
  OutputRequirements: OutputRequirementsSchema,
  StructuredObjective: StructuredObjectiveSchema,
  IRStep: IRStepSchema,
  IRConnection: IRConnectionSchema,
  FieldMapping: FieldMappingSchema,
  IRMetadata: IRMetadataSchema,
  IR: IRSchema,
  ProvenanceMetadata: ProvenanceMetadataSchema,
  StructuralError: StructuralErrorSchema,
  FailureTrace: FailureTraceSchema,
} as const;

export type Schemas = typeof Schemas;
