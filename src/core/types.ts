/**
 * AI Data Intelligence Platform - Core Type Definitions
 * This file contains type definitions. Error types are defined in errors.ts
 */

// ============================================================================
// Capability Vocabulary
// ============================================================================

export type CapabilityType =
  | 'Discover'
  | 'Acquire'
  | 'Extract'
  | 'Transform'
  | 'Enrich'
  | 'Resolve'
  | 'Filter'
  | 'Validate'
  | 'Provenance'
  | 'Persist'
  | 'Deliver';

/**
 * Parameter types for capability definitions
 */
export type ParameterType =
  'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'object' | 'object[]' | 'any';

export interface CapabilityDefinition {
  type: CapabilityType;
  description: string;
  requiredParameters: Record<string, ParameterType>;
  outputFields: Record<string, string | string[]>;
}

export const CAPABILITY_VOCABULARY: Record<CapabilityType, CapabilityDefinition> = {
  Discover: {
    type: 'Discover',
    description: 'Find data sources',
    requiredParameters: {
      query: 'string',
      source_type: 'string',
    },
    outputFields: {
      source_urls: ['string'],
    },
  },
  Acquire: {
    type: 'Acquire',
    description: 'Fetch content from URLs',
    requiredParameters: {
      urls: 'string[]',
      method: 'string',
    },
    outputFields: {
      contents: ['string'],
    },
  },
  Extract: {
    type: 'Extract',
    description: 'Parse structured data',
    requiredParameters: {
      content: 'string',
      schema: 'object',
    },
    outputFields: {
      records: ['object'],
    },
  },
  Transform: {
    type: 'Transform',
    description: 'Convert data formats',
    requiredParameters: {
      records: 'object[]',
      mapping: 'object',
    },
    outputFields: {
      transformed_records: ['object'],
    },
  },
  Enrich: {
    type: 'Enrich',
    description: 'Add derived fields',
    requiredParameters: {
      records: 'object[]',
      enrichments: 'object',
    },
    outputFields: {
      enriched_records: ['object'],
    },
  },
  Resolve: {
    type: 'Resolve',
    description: 'Link/fuse entities',
    requiredParameters: {
      records: 'object[]',
      keys: 'string[]',
    },
    outputFields: {
      resolved_records: ['object'],
    },
  },
  Filter: {
    type: 'Filter',
    description: 'Remove unwanted records',
    requiredParameters: {
      records: 'object[]',
      conditions: 'object[]',
    },
    outputFields: {
      filtered_records: ['object'],
    },
  },
  Validate: {
    type: 'Validate',
    description: 'Check data quality',
    requiredParameters: {
      records: 'object[]',
      rules: 'object[]',
    },
    outputFields: {
      validated_records: ['object'],
      errors: ['object'],
    },
  },
  Provenance: {
    type: 'Provenance',
    description: 'Attach source metadata',
    requiredParameters: {},
    outputFields: {
      records: ['object'],
    },
  },
  Persist: {
    type: 'Persist',
    description: 'Store results',
    requiredParameters: {
      records: 'object[]',
      destination: 'string',
    },
    outputFields: {
      storage_confirmation: 'object',
    },
  },
  Deliver: {
    type: 'Deliver',
    description: 'Export to user',
    requiredParameters: {
      records: 'object[]',
      format: 'string',
    },
    outputFields: {
      export_url: 'string',
    },
  },
};

// ============================================================================
// JSON Schema Types
// ============================================================================

export type JSONSchemaType =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  enum?: any[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  $ref?: string;
}

// ============================================================================
// User Prompt Types
// ============================================================================

export type UserPromptStatus =
  'pending' | 'planning' | 'verifying' | 'running' | 'completed' | 'failed';

export interface UserPrompt {
  id: string;
  prompt: string;
  created_at: string;
  status: UserPromptStatus;
  updated_at?: string;
}

// ============================================================================
// Structured Objective Types
// ============================================================================

export type ConstraintOperator =
  'equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in';

export interface Constraint {
  field: string;
  operator: ConstraintOperator;
  value: any;
  source?: string;
}

export type FieldDefinitionType =
  'string' | 'number' | 'date' | 'url' | 'email' | 'array' | 'object';

export interface FieldDefinition {
  name: string;
  type: FieldDefinitionType;
  required: boolean;
  description?: string;
}

export interface DataSourceHint {
  type?: string;
  hint?: string;
}

export interface OutputRequirements {
  format?: 'csv' | 'json';
  max_records?: number;
}

export interface StructuredObjective {
  id?: string;
  target_entity: string;
  constraints: Constraint[];
  required_fields: FieldDefinition[];
  data_sources?: DataSourceHint[];
  output_requirements?: OutputRequirements;
}

// ============================================================================
// IR (Intermediate Representation) Types
// ============================================================================

export interface IRStep {
  id: string;
  type: CapabilityType;
  parameters: Record<string, any>;
  input_schema: JSONSchema;
  output_schema: JSONSchema;
  position?: { x: number; y: number };
}

export interface IRConnection {
  from_step: string;
  from_output: string;
  to_step: string;
  to_input: string;
}

export interface TransformationSpec {
  type: string;
  parameters?: Record<string, any>;
}

export interface FieldMapping {
  target_field: string;
  source_step: string;
  source_field: string;
  transformation?: TransformationSpec;
}

export interface IRMetadata {
  objective_hash: string;
  created_at: string;
  planner_version: string;
}

export interface IR {
  id?: string;
  steps: IRStep[];
  connections: IRConnection[];
  field_mappings: FieldMapping[];
  metadata: IRMetadata;
}

// ============================================================================
// Provenance Metadata Types
// ============================================================================

export type ValidationStatus =
  'valid' | 'invalid:missing_field' | 'invalid:type_mismatch' | 'invalid:constraint_violation';

export interface ProvenanceMetadata {
  source_url: string | null;
  extraction_confidence: number;
  dedupe_group: string;
  validation_status: ValidationStatus;
}

// ============================================================================
// N8N Workflow Types
// ============================================================================

export interface N8NNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: string;
}

export interface N8NConnections {
  [nodeName: string]: {
    [outputName: string]: Array<{
      node: string;
      type: string;
      index: number;
    }>;
  };
}

export interface N8NWorkflow {
  name: string;
  nodes: N8NNode[];
  connections: N8NConnections;
  settings: Record<string, any>;
  staticData?: Record<string, any>;
}

export interface TemplateReference {
  template_id: string;
  node_count: number;
  capability_mapped: CapabilityType;
}

export interface TemplateManifest {
  templates_used: TemplateReference[];
  total_nodes: number;
  compilation_timestamp: string;
}

// ============================================================================
// Error and Validation Types (moved from errors.ts to avoid duplicate exports)
// ============================================================================

export type StructuralErrorType =
  | 'INVALID_STEP_TYPE'
  | 'MISSING_PARAMETER'
  | 'INVALID_PARAMETER_TYPE'
  | 'UNDEFINED_FIELD_REFERENCE';

export interface StructuralError {
  step_id: string;
  error_type: StructuralErrorType;
  message: string;
  location: { step: string; parameter?: string };
}

export interface VerifiedIR {
  ir: IR;
  validated_at: string;
  validator_version: string;
}

export type N8NValidationErrorType = string;

export interface N8NValidationError {
  node_id: string;
  error_code: string;
  message: string;
  api_response?: any;
}

export interface ValidatedWorkflow {
  workflow: N8NWorkflow;
  validated_at: string;
  validated_by: string;
}

// ============================================================================
// Contract Check Types
// ============================================================================

export interface ContractCertificate {
  satisfied_fields: string[];
  satisfied_required_fields: FieldDefinition[];
  provenance_verified: boolean;
  certification_timestamp: string;
  validator_version: string;
}

export interface ContractViolation {
  missing_field: string;
  expected_type: string;
  required_by: string;
  step_id?: string;
}

export interface ContractCheckResult {
  status: 'certified' | 'violation';
  certificate?: ContractCertificate;
  violations?: ContractViolation[];
  checked_at: string;
}

// ============================================================================
// Execution and Observability Types
// ============================================================================

export type FailureClassification =
  'LOGIC_FAILURE' | 'INFRASTRUCTURE_FAILURE' | 'EXTERNAL_SOURCE_UNAVAILABLE';

export interface FailureTrace {
  step_id: string;
  error_message: string;
  stack_trace?: string;
  timestamp: string;
  classification: FailureClassification;
  retry_count: number;
}

export interface NodeStatus {
  node_name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  records_processed?: number;
  error_message?: string;
}

export interface ExecutionStatus {
  workflow_id: string;
  execution_id: string;
  status: 'running' | 'completed' | 'failed' | 'stalled';
  node_statuses: NodeStatus[];
  record_count?: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
}

// ============================================================================
// Deployment Types
// ============================================================================

export interface CredentialRequirement {
  credential_type: string;
  credential_name: string;
  required_for_step: string;
}

export interface DeploymentRecord {
  deployment_id: string;
  workflow_id: string;
  deployed_at: string;
  configuration_manifest: Record<string, any>;
  activation_status: 'active' | 'inactive';
  n8n_workflow_id?: string;
}

export interface DeployResult {
  status: 'deployed' | 'error';
  record?: DeploymentRecord;
  deployed_at: string;
}

export interface DeploymentErrorInfo {
  error_type: 'CREDENTIAL_MISSING' | 'DEPLOYMENT_FAILED' | 'ACTIVATION_FAILED';
  message: string;
  missing_credentials?: string[];
}

// ============================================================================
// Dashboard Types
// ============================================================================

export type VerificationStageStatus = 'pass' | 'fail' | 'pending' | 'skipped';

export interface VerificationStage {
  stage_name: string;
  status: VerificationStageStatus;
  timestamp?: string;
  error_details?: string;
}

export interface RecordWithProvenance extends Record<string, any> {
  _provenance: ProvenanceMetadata;
}

export interface RecordInspection {
  total_records: number;
  records: RecordWithProvenance[];
  pagination: PaginationInfo;
}

export interface PaginationInfo {
  page: number;
  page_size: number;
  total_pages: number;
  has_more: boolean;
}

export interface ExportOptions {
  formats: ('csv' | 'json')[];
  max_records: number;
  max_size_mb: number;
}

export interface DashboardData {
  verification_stages: VerificationStage[];
  execution_results: ExecutionResult[];
  record_inspection?: RecordInspection;
  export_options: ExportOptions;
}

export interface ExecutionResult {
  execution_id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  record_count?: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  verification_status: VerificationStageStatus;
}

// ============================================================================
// Repair Agent Types
// ============================================================================

export interface PatchAttempt {
  attempt_number: number;
  patch_description: string;
  result: 'success' | 'still_failing';
  new_failure_trace?: FailureTrace;
}

export interface EscalationReport {
  original_failure: FailureTrace;
  attempted_patches: PatchAttempt[];
  recommendation: string;
}

export interface RepairResult {
  status: 'patched' | 'escalated';
  patched_ir?: IR;
  patch_description?: string;
  escalation_report?: EscalationReport;
  repair_timestamp: string;
}

// ============================================================================
// Sandbox Types
// ============================================================================

export interface TestFixture {
  step_id: string;
  mock_data: Record<string, any>[];
}

export interface SandboxResult {
  status: 'success' | 'failure';
  sample_output?: Record<string, any>[];
  failure_classification?: FailureClassification;
  failure_trace?: FailureTrace;
  executed_at: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface TimeoutConfig {
  IntakeAgent: number;
  WorkflowPlanner: number;
  StructuralCheck: number;
  Compiler: number;
  CompiledWorkflowCheck: number;
  ContractCheck: number;
  Sandbox: number;
}

export interface RetryStrategy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrorTypes: string[];
}

export interface DegradationStrategy {
  enabled: boolean;
  fallbackMode: boolean;
  maxDegradedSources: number;
  alertThreshold: number;
}

export interface RepairStrategy {
  maxAttempts: number;
  maxPatchSize: number;
  requireManualEscalation: boolean;
  repairAgentTimeout: number;
}

export interface ErrorRecoveryConfig {
  retry: RetryStrategy;
  degradation: DegradationStrategy;
  repair: RepairStrategy;
  classification: Record<string, string[]>;
}

export interface ErrorThresholds {
  maxConsecutiveFailures: number;
  failureWindowMs: number;
  alertCooldownMs: number;
  maxErrorPayloadSize: number;
}
