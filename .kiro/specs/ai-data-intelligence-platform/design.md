# Design Document: AI Data Intelligence Platform

## Overview

The AI Data Intelligence Platform is a system that transforms natural language prompts into source-backed datasets through verified n8n workflows. The platform employs a three-phase architecture ensuring deterministic validation, LLM-driven planning, and controlled execution with full provenance tracking.

### Core Design Philosophy

**LLMs Reason, Deterministic Systems Prove**

The fundamental principle is that LLMs are excellent at understanding intent and generating plans, but should never directly author executable artifacts. This separation provides:

1. **Verifiability**: Deterministic compilers produce predictable, testable outputs
2. **Security**: No risk of LLM hallucinations in executable workflow JSON
3. **Debuggability**: Clear separation between planning errors and compilation errors
4. **Maintainability**: Capability vocabulary changes don't require LLM retraining

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              AI Data Intelligence Platform                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              PHASE 1: PLAN                                      │ │
│  │  ┌─────────────────┐          ┌─────────────────────┐                          │ │
│  │  │   Intake Agent  │ ───────▶ │  Workflow Planner   │                          │ │
│  │  │   (LLM-based)   │          │    (LLM-based)      │                          │ │
│  │  │                 │          │                     │                          │ │
│  │  │ • Parse prompt  │          │ • Capability graph  │                          │ │
│  │  │ • Extract entity│          │ • Data contracts    │                          │ │
│  │  │ • Constraints   │          │ • Field mappings    │                          │ │
│  │  └─────────────────┘          └─────────────────────┘                          │ │
│  │                                          │                                      │ │
│  │                                          ▼                                      │ │
│  │                              ┌─────────────────────┐                           │ │
│  │                              │    IR (Capability   │                           │ │
│  │                              │       Graph)        │                           │ │
│  │                              └─────────────────────┘                           │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                          │
│                                          ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                            PHASE 2: VERIFY                                      │ │
│  │                                                                                 │ │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐         │ │
│  │  │ Structural Check│───▶│    Compiler     │───▶│Compiled WF Check    │         │ │
│  │  │ (Deterministic) │    │ (Deterministic) │    │  (Deterministic)    │         │ │
│  │  │                 │    │                 │    │                     │         │ │
│  │  │ • Step types    │    │ • Template map  │    │ • n8n API validate  │         │ │
│  │  │ • Parameters    │    │ • Node assembly │    │ • Schema check      │         │ │
│  │  │ • Field refs    │    │ • Connections   │    │                     │         │ │
│  │  └─────────────────┘    └─────────────────┘    └─────────────────────┘         │ │
│  │          │                                              │                      │ │
│  │          │               ┌──────────────────────────────┘                      │ │
│  │          │               ▼                                                      │ │
│  │          │    ┌─────────────────────┐    ┌─────────────────────┐              │ │
│  │          └───▶│   Contract Check    │───▶│      Sandbox        │              │ │
│  │               │  (Deterministic)    │    │   (Isolated Env)    │              │ │
│  │               │                     │    │                     │              │ │
│  │               │ • Set difference    │    │ • Test fixtures     │              │ │
│  │               │ • Field coverage    │    │ • Timeout enforce   │              │ │
│  │               │ • Provenance verify │    │ • Failure classify  │              │ │
│  │               └─────────────────────┘    └─────────────────────┘              │ │
│  │                                                   │                           │ │
│  │                     ┌─────────────────────────────┼──────────────────┐        │ │
│  │                     │                             │                  │        │ │
│  │                     ▼                             ▼                  ▼        │ │
│  │          ┌─────────────────┐          ┌─────────────────┐    ┌────────────┐   │ │
│  │          │ Repair Agent    │          │ Deploy Ready    │    │ Escalate   │   │ │
│  │          │ (LLM-based)     │          │                 │    │ (Manual)   │   │ │
│  │          │                 │          │                 │    │            │   │ │
│  │          │ • Patch IR      │◀─────────┤ LOGIC_FAILURE   │    │ Max repair │   │ │
│  │          │ • Max 3 retries │          │                 │    │ exhausted  │   │ │
│  │          └─────────────────┘          └─────────────────┘    └────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                          │
│                                          ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              PHASE 3: RUN                                       │ │
│  │                                                                                 │ │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐         │ │
│  │  │    Deployer     │───▶│  n8n Instance   │───▶│   Observability     │         │ │
│  │  │                 │    │                 │    │                     │         │ │
│  │  │ • Credentials   │    │ • Execute WF    │    │ • Webhooks          │         │ │
│  │  │ • Activate      │    │ • Produce data  │    │ • Reconciliation    │         │ │
│  │  │ • Record deploy │    │                 │    │ • Status API        │         │ │
│  │  └─────────────────┘    └─────────────────┘    └─────────────────────┘         │ │
│  │                                                         │                       │ │
│  │                                                         ▼                       │ │
│  │                                             ┌─────────────────────┐             │ │
│  │                                             │    Provenance       │             │ │
│  │                                             │    System           │             │ │
│  │                                             │                     │             │ │
│  │                                             │ • source_url        │             │ │
│  │                                             │ • extraction_conf   │             │ │
│  │                                             │ • dedupe_group      │             │ │
│  │                                             │ • validation_status │             │ │
│  │                                             └─────────────────────┘             │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                          │
│                                          ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              Dashboard Interface                                │ │
│  │                                                                                 │ │
│  │  • Verification stages (pass/fail indicators)                                  │ │
│  │  • Record counts and execution duration                                         │ │
│  │  • Source URL and provenance inspection                                         │ │
│  │  • Export (CSV/JSON) with limits: 1M records or 500MB                          │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Architecture

### Three-Phase Design Pattern

The platform implements a strict three-phase pipeline with clear ownership boundaries:

| Phase | Owner | LLM Usage | Deterministic |
|-------|-------|-----------|---------------|
| **Plan** | LLM Agents | High | No |
| **Verify** | Validators | None | Yes |
| **Run** | Orchestrator | None | Yes |

This separation ensures that verification is always reproducible and auditable.

### Component Communication Pattern

Components communicate through well-defined data structures:

1. **User Prompt** (string) → Intake Agent
2. **Structured Objective** (JSON) → Workflow Planner
3. **IR/Capability Graph** (JSON) → Structural Check
4. **Verified IR** (JSON) → Compiler
5. **Compiled Workflow** (n8n JSON) → Compiled Workflow Check
6. **Validated Workflow** (n8n JSON) → Contract Check
7. **Certified Workflow** (n8n JSON) → Sandbox
8. **Deploy Ready Workflow** (n8n JSON) → Deployer

Each transition is validated, and failures trigger appropriate handlers.

### Failure Classification and Response

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Failure Classification Flow                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────────┐                                                │
│   │ Failure Occurs  │                                                │
│   └────────┬────────┘                                                │
│            │                                                          │
│            ▼                                                          │
│   ┌─────────────────────────────────────────────────────────────┐    │
│   │                  Failure Classifier                          │    │
│   │                                                              │    │
│   │  Is the failure due to:                                      │    │
│   │  1. Incorrect workflow logic? ──────────▶ LOGIC_FAILURE     │    │
│   │  2. Infrastructure issues? ─────────────▶ INFRASTRUCTURE    │    │
│   │  3. External source down? ──────────────▶ EXTERNAL_SOURCE   │    │
│   └─────────────────────────────────────────────────────────────┘    │
│            │                                                          │
│            ├──────────────────┬───────────────────┐                  │
│            ▼                  ▼                   ▼                  │
│   ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐    │
│   │ LOGIC_FAILURE  │  │INFRASTRUCTURE  │  │EXTERNAL_SOURCE     │    │
│   │                │  │ _FAILURE       │  │_UNAVAILABLE        │    │
│   │ • Block exec   │  │                │  │                    │    │
│   │ • Repair Agent │  │ • Retry (exp   │  │ • Degraded mode    │    │
│   │ • Max 3 tries  │  │   backoff, 3x) │  │ • Continue with    │    │
│   │ • Escalate if  │  │ • Alert ops    │  │   available sources│    │
│   │   exhausted    │  │                │  │ • Mark source down │    │
│   └────────────────┘  └────────────────┘  └────────────────────┘    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component Overview Table

| Component | Type | Input | Output | Timeout |
|-----------|------|-------|--------|---------|
| Intake Agent | LLM | User Prompt (string) | Structured Objective (JSON) | 30s |
| Workflow Planner | LLM | Structured Objective | IR/Capability Graph | 30s |
| Structural Check | Deterministic | IR | Verified IR or Error | 500ms |
| Compiler | Deterministic | Verified IR | n8n Workflow JSON | 500ms |
| Compiled Workflow Check | Deterministic | n8n JSON | Validated n8n JSON | 500ms |
| Contract Check | Deterministic | Validated n8n JSON | Contract Certificate | 200ms |
| Sandbox | Isolated Env | Certified n8n JSON | Sample Output or Failure | Configurable |
| Repair Agent | LLM | Failure Trace + IR | Patched IR | 30s |
| Deployer | Orchestrator | Deploy Ready JSON | Deployment Record | Variable |
| Observability | Service | Webhooks + Polls | Status API | N/A |
| Provenance System | Service | Records + Metadata | Enriched Records | N/A |
| Dashboard | UI | Status API Data | User Interface | N/A |

### 1. Intake Agent

**Purpose**: Transform natural language prompts into structured objectives.

**Type**: LLM-based with schema-constrained output.

```typescript
interface IntakeAgentInput {
  prompt: string;  // 1-10,000 characters
}

interface IntakeAgentOutput {
  structured_objective: {
    target_entity: string;
    constraints: Constraint[];
    required_fields: FieldDefinition[];
    data_sources: DataSourceHint[];
    output_requirements: OutputRequirements;
  };
  interpretation_confidence: number;  // 0.0-1.0
  assumptions: Assumption[];
  clarification_needed?: ClarificationRequest;
}

interface Constraint {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in';
  value: any;
  source?: string;  // Where constraint was extracted from
}

interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'date' | 'url' | 'email' | 'array' | 'object';
  required: boolean;
  description?: string;
}

interface ClarificationRequest {
  questions: string[];
  suggested_answers?: string[];
}
```

**Behavior**:
- Parse prompt within 30 seconds or timeout
- Output must conform to JSON schema (validated by constrained decoding)
- If ambiguous, return clarification request
- Document assumptions when multiple interpretations exist

### 2. Workflow Planner

**Purpose**: Generate capability graphs using the closed vocabulary.

**Type**: LLM-based with vocabulary constraints.

```typescript
interface WorkflowPlannerInput {
  structured_objective: StructuredObjective;
}

interface WorkflowPlannerOutput {
  capability_graph: IR;
}

interface IR {
  steps: IRStep[];
  connections: IRConnection[];
  field_mappings: FieldMapping[];
  metadata: IRMetadata;
}

interface IRStep {
  id: string;
  type: CapabilityType;  // Must be from closed vocabulary
  parameters: Record<string, any>;
  input_schema: JSONSchema;
  output_schema: JSONSchema;
  position: { x: number; y: number };  // For visualization
}

interface IRConnection {
  from_step: string;
  from_output: string;
  to_step: string;
  to_input: string;
}

interface FieldMapping {
  target_field: string;
  source_step: string;
  source_field: string;
  transformation?: TransformationSpec;
}

type CapabilityType = 
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

interface IRMetadata {
  objective_hash: string;
  created_at: string;
  planner_version: string;
}
```

**Capability Vocabulary Definitions**:

| Capability | Purpose | Required Parameters | Output |
|------------|---------|---------------------|--------|
| **Discover** | Find data sources | query, source_type | source_urls[] |
| **Acquire** | Fetch content from URLs | urls, method | raw_content[] |
| **Extract** | Parse structured data | content, schema | records[] |
| **Transform** | Convert data formats | records, mapping | transformed_records[] |
| **Enrich** | Add derived fields | records, enrichments | enriched_records[] |
| **Resolve** | Link/fuse entities | records, keys | resolved_records[] |
| **Filter** | Remove unwanted records | records, conditions | filtered_records[] |
| **Validate** | Check data quality | records, rules | validated_records[] + errors |
| **Provenance** | Attach source metadata | records | provenanced_records[] |
| **Persist** | Store results | records, destination | storage_confirmation |
| **Deliver** | Export to user | records, format | export_url |

### 3. Structural Check

**Purpose**: Deterministically validate IR structure before compilation.

**Type**: Deterministic validator (no LLM).

```typescript
interface StructuralCheckInput {
  ir: IR;
}

interface StructuralCheckOutput {
  status: 'valid' | 'invalid';
  verified_ir?: IR;
  errors?: StructuralError[];
}

interface StructuralError {
  step_id: string;
  error_type: 'INVALID_STEP_TYPE' | 'MISSING_PARAMETER' | 'INVALID_PARAMETER_TYPE' | 'UNDEFINED_FIELD_REFERENCE';
  message: string;
  location: { step: string; parameter?: string };
}
```

**Validation Rules**:

1. **Step Type Validation**: All step types must be in Capability Vocabulary
2. **Parameter Completeness**: All required parameters present for each step type
3. **Parameter Type Checking**: Parameters must match declared types
4. **Field Reference Validation**: Referenced fields must exist in upstream outputs
5. **Connection Validity**: Connections must reference existing steps

### 4. Compiler

**Purpose**: Assemble verified IR into n8n workflow JSON.

**Type**: Deterministic assembler (no LLM).

```typescript
interface CompilerInput {
  verified_ir: IR;
}

interface CompilerOutput {
  workflow_json: N8NWorkflow;
  manifest: TemplateManifest;
}

interface N8NWorkflow {
  name: string;
  nodes: N8NNode[];
  connections: N8NConnections;
  settings: Record<string, any>;
  staticData: Record<string, any>;
}

interface N8NNode {
  id: string;
  name: string;
  type: string;  // n8n node type
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: string;
}

interface N8NConnections {
  [nodeName: string]: {
    [outputName: string]: Array<{
      node: string;
      type: string;
      index: number;
    }>;
  };
}

interface TemplateManifest {
  templates_used: TemplateReference[];
  total_nodes: number;
  compilation_timestamp: string;
}

interface TemplateReference {
  template_id: string;
  node_count: number;
  capability_mapped: CapabilityType;
}
```

**Template Mapping**:

The Compiler maintains a template registry mapping capability types to n8n node templates:

| Capability | n8n Node Type | Template ID |
|------------|---------------|-------------|
| Discover | HTTP Request + HTML Extract | `tpl-discover-01` |
| Acquire | HTTP Request | `tpl-acquire-01` |
| Extract | Code Node (JSON parser) | `tpl-extract-01` |
| Transform | Code Node (mapper) | `tpl-transform-01` |
| Enrich | HTTP Request + Merge | `tpl-enrich-01` |
| Resolve | Code Node (dedupe) | `tpl-resolve-01` |
| Filter | Filter Node | `tpl-filter-01` |
| Validate | Code Node (validator) | `tpl-validate-01` |
| Provenance | Code Node (metadata) | `tpl-provenance-01` |
| Persist | Database/Storage Node | `tpl-persist-01` |
| Deliver | Respond to Webhook | `tpl-deliver-01` |

### 5. Compiled Workflow Check

**Purpose**: Validate compiled n8n workflow against n8n API.

**Type**: Deterministic API validator (no LLM).

```typescript
interface CompiledWorkflowCheckInput {
  workflow_json: N8NWorkflow;
}

interface CompiledWorkflowCheckOutput {
  status: 'valid' | 'invalid';
  validated_workflow?: N8NWorkflow;
  errors?: N8NValidationError[];
}

interface N8NValidationError {
  node_id: string;
  error_code: string;
  message: string;
  api_response?: any;
}
```

**Process**:
1. Submit workflow JSON to n8n validation endpoint
2. Capture any schema validation errors
3. Return structured error information or validation success

### 6. Contract Check

**Purpose**: Prove workflow output satisfies user requirements.

**Type**: Deterministic proof generator (no LLM).

```typescript
interface ContractCheckInput {
  workflow_json: N8NWorkflow;
  required_fields: FieldDefinition[];
  provenance_required: boolean;
}

interface ContractCheckOutput {
  status: 'certified' | 'violation';
  certificate?: ContractCertificate;
  violations?: ContractViolation[];
}

interface ContractCertificate {
  satisfied_fields: string[];
  provenance_verified: boolean;
  certification_timestamp: string;
}

interface ContractViolation {
  missing_field: string;
  expected_type: string;
  required_by: string;  // Which step/requirement needs this
}
```

**Algorithm**:

```
function contractCheck(workflow, required_fields, provenance_required):
    // Collect all output fields from final Deliver step
    final_output_schema = getFinalOutputSchema(workflow)
    
    // Compute set difference
    missing_fields = required_fields - final_output_schema.fields
    
    if missing_fields is empty:
        // Verify provenance if required
        if provenance_required:
            if not hasProvenanceField(final_output_schema, 'source_url'):
                return violation('Missing source_url for provenance')
        
        return certified(satisfied_fields: required_fields)
    else:
        return violation(missing_fields)
```

### 7. Sandbox Execution Environment

**Purpose**: Execute workflows in isolation with test fixtures.

**Type**: Isolated execution environment.

```typescript
interface SandboxInput {
  workflow_json: N8NWorkflow;
  test_fixtures?: TestFixture[];
}

interface SandboxOutput {
  status: 'success' | 'failure';
  sample_output?: Record<string, any>[];
  failure_classification?: FailureClassification;
  failure_trace?: FailureTrace;
}

interface TestFixture {
  step_id: string;
  mock_data: Record<string, any>[];
}

type FailureClassification = 'LOGIC_FAILURE' | 'INFRASTRUCTURE_FAILURE' | 'EXTERNAL_SOURCE_UNAVAILABLE';

interface FailureTrace {
  step_id: string;
  error_message: string;
  stack_trace?: string;
  timestamp: string;
  classification: FailureClassification;
  retry_count: number;
}
```

**Timeout Configuration**:
- Default timeout: Configurable per workflow
- Maximum execution time: Prevent runaway workflows
- Heartbeat check: Detect stalled executions

**Failure Handling**:

| Classification | Action | Retry | Escalate |
|----------------|--------|-------|----------|
| LOGIC_FAILURE | Block execution, trigger Repair Agent | No | After 3 repair attempts |
| INFRASTRUCTURE_FAILURE | Retry with exponential backoff | Up to 3 times | After retries exhausted |
| EXTERNAL_SOURCE_UNAVAILABLE | Mark source degraded, continue | No | No, degraded mode |

### 8. Repair Agent

**Purpose**: Patch failing IR steps based on failure traces.

**Type**: LLM-based with IR constraints.

```typescript
interface RepairAgentInput {
  failure_trace: FailureTrace;
  original_ir: IR;
  attempt_number: number;  // 1, 2, or 3
}

interface RepairAgentOutput {
  status: 'patched' | 'escalated';
  patched_ir?: IR;
  patch_description?: string;
  escalation_report?: EscalationReport;
}

interface EscalationReport {
  original_failure: FailureTrace;
  attempted_patches: PatchAttempt[];
  recommendation: string;
}

interface PatchAttempt {
  attempt_number: number;
  patch_description: string;
  result: 'success' | 'still_failing';
  new_failure_trace?: FailureTrace;
}
```

**Constraints**:
- Maximum 3 repair attempts
- Only patch failing step and immediate dependencies
- Document all attempted patches
- Escalate with detailed report if exhausted

### 9. Deployer

**Purpose**: Deploy verified workflows to n8n instance.

**Type**: Orchestrator.

```typescript
interface DeployerInput {
  workflow_json: N8NWorkflow;
  credential_requirements: CredentialRequirement[];
}

interface DeployerOutput {
  status: 'deployed' | 'error';
  deployment_record?: DeploymentRecord;
  error?: DeploymentError;
}

interface CredentialRequirement {
  credential_type: string;
  credential_name: string;
  required_for_step: string;
}

interface DeploymentRecord {
  deployment_id: string;
  workflow_id: string;
  deployed_at: string;
  configuration_manifest: Record<string, any>;
  activation_status: 'active' | 'inactive';
}

interface DeploymentError {
  error_type: 'CREDENTIAL_MISSING' | 'DEPLOYMENT_FAILED' | 'ACTIVATION_FAILED';
  message: string;
  missing_credentials?: string[];
}
```

### 10. Observability Layer

**Purpose**: Monitor workflow execution in real-time.

**Type**: Service with webhook and polling.

```typescript
interface ObservabilityConfig {
  webhook_endpoint: string;
  reconciliation_poll_interval_ms: number;
  stalled_workflow_threshold_ms: number;
}

interface ExecutionStatus {
  workflow_id: string;
  execution_id: string;
  status: 'running' | 'completed' | 'failed' | 'stalled';
  node_statuses: NodeStatus[];
  record_count?: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
}

interface NodeStatus {
  node_name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  records_processed?: number;
  error_message?: string;
}
```

**Monitoring Mechanisms**:

1. **Webhooks**: n8n sends node-level status updates
2. **Reconciliation Polls**: Detect stalled workflows by periodic checks
3. **Duration Tracking**: Flag workflows exceeding expected duration
4. **Status API**: Queryable interface for execution state

### 11. Provenance System

**Purpose**: Attach source traceability and quality metadata to every record.

**Type**: Data enrichment service.

```typescript
interface ProvenanceMetadata {
  source_url: string | null;
  extraction_confidence: number;  // 0.0-1.0, 4 decimal places
  dedupe_group: string;  // Content fingerprint
  validation_status: ValidationStatus;
}

type ValidationStatus = 
  | 'valid'
  | 'invalid:missing_field'
  | 'invalid:type_mismatch'
  | 'invalid:constraint_violation';

interface DeduplicationResult {
  original_count: number;
  duplicate_count: number;
  final_count: number;
  dedupe_groups: DedupeGroup[];
}

interface DedupeGroup {
  group_id: string;
  records: Record<string, any>[];
  selected_record: Record<string, any>;  // Highest confidence
}
```

**Provenance Rules**:

1. **source_url**: Required when provenance is requested; reject null values
2. **extraction_confidence**: Numeric 0.0-1.0 with 4 decimal precision
3. **dedupe_group**: Content fingerprint for duplicate detection
4. **validation_status**: Indicates pass/failure with specific reason

### 12. Dashboard Interface

**Purpose**: Visual interface for monitoring and data access.

**Type**: Web UI.

```typescript
interface DashboardData {
  verification_stages: VerificationStage[];
  execution_results: ExecutionResult[];
  record_inspection: RecordInspection;
  export_options: ExportOptions;
}

interface VerificationStage {
  stage_name: string;
  status: 'pass' | 'fail' | 'pending' | 'skipped';
  timestamp?: string;
  error_details?: string;
}

interface RecordInspection {
  total_records: number;
  records: RecordWithProvenance[];
  pagination: PaginationInfo;
}

interface RecordWithProvenance extends Record<string, any> {
  _provenance: ProvenanceMetadata;
}

interface ExportOptions {
  formats: ('csv' | 'json')[];
  max_records: 1000000;
  max_size_mb: 500;
}
```

**Dashboard Features**:

1. **Verification Stages**: Independent pass/fail indicators
2. **Execution History**: Timestamps and workflow identifiers
3. **Record Inspection**: Source URL and provenance display
4. **Export**: CSV/JSON with limits (1M records, 500MB)

## Data Models

### Primary Entities

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Entity Relationship Diagram                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────────┐         ┌─────────────────┐                   │
│   │    UserPrompt   │         │ StructuredObj   │                   │
│   ├─────────────────┤         ├─────────────────┤                   │
│   │ id: UUID        │────────▶│ id: UUID        │                   │
│   │ prompt: string  │         │ target_entity   │                   │
│   │ created_at      │         │ constraints[]   │                   │
│   │ status          │         │ required_fields │                   │
│   └─────────────────┘         │ data_sources[]  │                   │
│                               └────────┬────────┘                   │
│                                        │                             │
│                                        ▼                             │
│   ┌─────────────────┐         ┌─────────────────┐                   │
│   │ DeployedWF      │         │      IR         │                   │
│   ├─────────────────┤         ├─────────────────┤                   │
│   │ id: UUID        │◀────────│ id: UUID        │                   │
│   │ n8n_wf_id       │         │ steps[]         │                   │
│   │ deployed_at     │         │ connections[]   │                   │
│   │ status          │         │ field_mappings  │                   │
│   └────────┬────────┘         └─────────────────┘                   │
│            │                                                          │
│            ▼                                                          │
│   ┌─────────────────┐         ┌─────────────────┐                   │
│   │   Execution     │         │    Record       │                   │
│   ├─────────────────┤         ├─────────────────┤                   │
│   │ id: UUID        │────────▶│ id: UUID        │                   │
│   │ workflow_id     │         │ data: JSON      │                   │
│   │ status          │         │ provenance_id   │───┐               │
│   │ record_count    │         └─────────────────┘   │               │
│   │ started_at      │                               │               │
│   │ completed_at    │                               │               │
│   └─────────────────┘                               │               │
│                                                     ▼               │
│                                            ┌─────────────────┐      │
│                                            │  Provenance     │      │
│                                            ├─────────────────┤      │
│                                            │ id: UUID        │      │
│                                            │ source_url      │      │
│                                            │ extraction_conf │      │
│                                            │ dedupe_group    │      │
│                                            │ validation_stat │      │
│                                            └─────────────────┘      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Schema Definitions

#### UserPrompt Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "prompt", "created_at", "status"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "prompt": { "type": "string", "minLength": 1, "maxLength": 10000 },
    "created_at": { "type": "string", "format": "date-time" },
    "status": {
      "type": "string",
      "enum": ["pending", "planning", "verifying", "running", "completed", "failed"]
    }
  }
}
```

#### StructuredObjective Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["target_entity", "constraints", "required_fields"],
  "properties": {
    "target_entity": { "type": "string" },
    "constraints": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["field", "operator", "value"],
        "properties": {
          "field": { "type": "string" },
          "operator": {
            "type": "string",
            "enum": ["equals", "contains", "greater_than", "less_than", "between", "in"]
          },
          "value": {},
          "source": { "type": "string" }
        }
      }
    },
    "required_fields": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type", "required"],
        "properties": {
          "name": { "type": "string" },
          "type": {
            "type": "string",
            "enum": ["string", "number", "date", "url", "email", "array", "object"]
          },
          "required": { "type": "boolean" },
          "description": { "type": "string" }
        }
      }
    },
    "data_sources": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "hint": { "type": "string" }
        }
      }
    },
    "output_requirements": {
      "type": "object",
      "properties": {
        "format": { "type": "string", "enum": ["csv", "json"] },
        "max_records": { "type": "integer", "minimum": 1, "maximum": 1000000 }
      }
    }
  }
}
```

#### IR Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["steps", "connections", "field_mappings", "metadata"],
  "properties": {
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "parameters", "input_schema", "output_schema"],
        "properties": {
          "id": { "type": "string" },
          "type": {
            "type": "string",
            "enum": ["Discover", "Acquire", "Extract", "Transform", "Enrich", "Resolve", "Filter", "Validate", "Provenance", "Persist", "Deliver"]
          },
          "parameters": { "type": "object" },
          "input_schema": { "$ref": "#/definitions/schema" },
          "output_schema": { "$ref": "#/definitions/schema" },
          "position": {
            "type": "object",
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" }
            }
          }
        }
      }
    },
    "connections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from_step", "from_output", "to_step", "to_input"],
        "properties": {
          "from_step": { "type": "string" },
          "from_output": { "type": "string" },
          "to_step": { "type": "string" },
          "to_input": { "type": "string" }
        }
      }
    },
    "field_mappings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["target_field", "source_step", "source_field"],
        "properties": {
          "target_field": { "type": "string" },
          "source_step": { "type": "string" },
          "source_field": { "type": "string" },
          "transformation": {
            "type": "object",
            "properties": {
              "type": { "type": "string" },
              "parameters": { "type": "object" }
            }
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["objective_hash", "created_at", "planner_version"],
      "properties": {
        "objective_hash": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" },
        "planner_version": { "type": "string" }
      }
    }
  },
  "definitions": {
    "schema": {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "properties": { "type": "object" },
        "required": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

#### Provenance Metadata Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["source_url", "extraction_confidence", "dedupe_group", "validation_status"],
  "properties": {
    "source_url": { "type": ["string", "null"], "format": "uri" },
    "extraction_confidence": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0
    },
    "dedupe_group": { "type": "string" },
    "validation_status": {
      "type": "string",
      "enum": ["valid", "invalid:missing_field", "invalid:type_mismatch", "invalid:constraint_violation"]
    }
  }
}
```

### Data Flow Example

**User Prompt**: "Find 100 Indian AI startups founded after 2023 with founders, funding, website, and evidence"

**Structured Objective**:
```json
{
  "target_entity": "AI Startup",
  "constraints": [
    { "field": "country", "operator": "equals", "value": "India" },
    { "field": "founded_year", "operator": "greater_than", "value": 2023 },
    { "field": "count", "operator": "equals", "value": 100 }
  ],
  "required_fields": [
    { "name": "name", "type": "string", "required": true },
    { "name": "founders", "type": "array", "required": true },
    { "name": "funding", "type": "string", "required": true },
    { "name": "website", "type": "url", "required": true },
    { "name": "evidence", "type": "url", "required": true }
  ],
  "data_sources": [
    { "type": "web", "hint": "startup directories, news sites, Crunchbase" }
  ],
  "output_requirements": {
    "format": "json",
    "max_records": 100
  }
}
```

**IR Capability Graph**:
```json
{
  "steps": [
    {
      "id": "step-1",
      "type": "Discover",
      "parameters": {
        "query": "Indian AI startups founded 2024 2025",
        "source_type": "web"
      },
      "input_schema": { "type": "null" },
      "output_schema": {
        "type": "object",
        "properties": {
          "source_urls": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    {
      "id": "step-2",
      "type": "Acquire",
      "parameters": { "method": "GET" },
      "input_schema": {
        "type": "object",
        "properties": {
          "urls": { "type": "array", "items": { "type": "string" } }
        }
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "contents": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    {
      "id": "step-3",
      "type": "Extract",
      "parameters": {
        "schema": {
          "name": "string",
          "founders": "array",
          "funding": "string",
          "website": "url",
          "founded_year": "number"
        }
      },
      "input_schema": {
        "type": "object",
        "properties": {
          "contents": { "type": "array", "items": { "type": "string" } }
        }
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "records": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "founders": { "type": "array" },
                "funding": { "type": "string" },
                "website": { "type": "string" },
                "founded_year": { "type": "number" }
              }
            }
          }
        }
      }
    },
    {
      "id": "step-4",
      "type": "Filter",
      "parameters": {
        "conditions": [
          { "field": "country", "operator": "equals", "value": "India" },
          { "field": "founded_year", "operator": "greater_than", "value": 2023 }
        ]
      },
      "input_schema": { "type": "object" },
      "output_schema": { "type": "object" }
    },
    {
      "id": "step-5",
      "type": "Provenance",
      "parameters": {},
      "input_schema": { "type": "object" },
      "output_schema": {
        "type": "object",
        "properties": {
          "records": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "_provenance": { "type": "object" }
              }
            }
          }
        }
      }
    },
    {
      "id": "step-6",
      "type": "Validate",
      "parameters": {
        "rules": [
          { "field": "name", "required": true },
          { "field": "website", "required": true }
        ]
      },
      "input_schema": { "type": "object" },
      "output_schema": { "type": "object" }
    },
    {
      "id": "step-7",
      "type": "Deliver",
      "parameters": { "format": "json" },
      "input_schema": { "type": "object" },
      "output_schema": {
        "type": "object",
        "properties": {
          "export_url": { "type": "string" }
        }
      }
    }
  ],
  "connections": [
    { "from_step": "step-1", "from_output": "source_urls", "to_step": "step-2", "to_input": "urls" },
    { "from_step": "step-2", "from_output": "contents", "to_step": "step-3", "to_input": "contents" },
    { "from_step": "step-3", "from_output": "records", "to_step": "step-4", "to_input": "records" },
    { "from_step": "step-4", "from_output": "records", "to_step": "step-5", "to_input": "records" },
    { "from_step": "step-5", "from_output": "records", "to_step": "step-6", "to_input": "records" },
    { "from_step": "step-6", "from_output": "records", "to_step": "step-7", "to_input": "records" }
  ],
  "field_mappings": [
    { "target_field": "name", "source_step": "step-3", "source_field": "name" },
    { "target_field": "founders", "source_step": "step-3", "source_field": "founders" },
    { "target_field": "funding", "source_step": "step-3", "source_field": "funding" },
    { "target_field": "website", "source_step": "step-3", "source_field": "website" },
    { "target_field": "evidence", "source_step": "step-5", "source_field": "_provenance.source_url" }
  ],
  "metadata": {
    "objective_hash": "sha256:abc123",
    "created_at": "2025-01-15T10:30:00Z",
    "planner_version": "1.0.0"
  }
}
```

## Error Handling

### Error Taxonomy

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Error Hierarchy                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   PlatformError                                                      │
│   ├── PlanningError                                                  │
│   │   ├── PromptParsingError                                         │
│   │   │   ├── PromptTooLongError (max 10,000 chars)                 │
│   │   │   ├── PromptEmptyError                                       │
│   │   │   └── AmbiguousPromptError                                   │
│   │   ├── CapabilityNotInVocabularyError                             │
│   │   └── IrGenerationError                                          │
│   │                                                                   │
│   ├── ValidationError                                                │
│   │   ├── StructuralValidationError                                  │
│   │   │   ├── InvalidStepTypeError                                   │
│   │   │   ├── MissingParameterError                                  │
│   │   │   └── UndefinedFieldReferenceError                           │
│   │   ├── CompilationError                                           │
│   │   │   ├── TemplateNotFoundError                                  │
│   │   │   └── NodeAssemblyError                                      │
│   │   ├── ContractViolationError                                     │
│   │   │   └── MissingFieldError                                      │
│   │   └── SandboxExecutionError                                      │
│   │                                                                   │
│   ├── ExecutionError                                                 │
│   │   ├── LogicFailureError (→ Repair Agent)                        │
│   │   ├── InfrastructureFailureError (→ Retry)                      │
│   │   └── ExternalSourceUnavailableError (→ Degraded Mode)          │
│   │                                                                   │
│   └── DeploymentError                                                │
│       ├── CredentialMissingError                                     │
│       ├── DeploymentFailedError                                      │
│       └── ActivationFailedError                                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Error Response Format

```typescript
interface ErrorResponse {
  error_id: string;
  error_type: string;
  message: string;
  timestamp: string;
  context: Record<string, any>;
  retryable: boolean;
  recovery_action?: string;
}
```

### Error Handling Strategies

| Error Category | Strategy | Recovery |
|----------------|----------|----------|
| **PromptParsingError** | Return clarification request | User provides more detail |
| **StructuralValidationError** | Return precise error locations | Fix IR or escalate |
| **ContractViolationError** | Return missing fields | Regenerate IR or fix mappings |
| **LogicFailureError** | Trigger Repair Agent | Up to 3 repair attempts |
| **InfrastructureFailureError** | Retry with exponential backoff | Up to 3 retries |
| **ExternalSourceUnavailableError** | Degraded mode | Continue with available sources |
| **CredentialMissingError** | Return credential error | Configure credentials |

### Timeout Handling

| Component | Timeout | On Timeout |
|-----------|---------|------------|
| Intake Agent | 30s | Return timeout error |
| Workflow Planner | 30s | Return timeout error |
| Structural Check | 500ms | Return validation timeout |
| Compiler | 500ms | Return compilation timeout |
| Compiled Workflow Check | 500ms | Return API timeout |
| Contract Check | 200ms | Return verification timeout |
| Sandbox | Configurable | Classify as INFRASTRUCTURE_FAILURE |

## Testing Strategy

### Testing Approach

This feature involves complex stateful orchestration with LLM components, deterministic validators, and external service integrations. The testing strategy employs multiple approaches:

1. **Property-Based Testing**: For deterministic validators (Structural Check, Compiler, Contract Check)
2. **Unit Tests**: For specific logic paths and edge cases
3. **Integration Tests**: For n8n API interactions and end-to-end flows
4. **Mock-Based Tests**: For LLM component behavior isolation

### Test Categories

| Category | Components | Approach |
|----------|------------|----------|
| **LLM Components** | Intake Agent, Workflow Planner, Repair Agent | Mock-based unit tests, integration tests with real LLM |
| **Deterministic Validators** | Structural Check, Compiler, Contract Check | Property-based tests |
| **External Integrations** | n8n API, Sandbox | Integration tests with mock fixtures |
| **Orchestration** | Deployer, Observability | Integration tests |

### Unit Testing

**Focus Areas**:
- Specific parsing examples for Intake Agent
- Edge cases in IR validation
- Error condition handling
- Timeout behavior
- Boundary conditions (prompt length, record limits)

**Examples**:
- Empty prompt handling
- Maximum prompt length (10,000 chars)
- Invalid capability type in IR
- Missing required parameter
- Field reference to non-existent step

### Integration Testing

**Focus Areas**:
- n8n API validation endpoints
- Sandbox execution with test fixtures
- Deployment with credential resolution
- Webhook handling from n8n

**Test Fixtures**:
```typescript
interface TestFixture {
  name: string;
  ir: IR;
  expected_workflow: N8NWorkflow;
  expected_output: Record<string, any>[];
  mock_responses: MockResponse[];
}
```

### Mock-Based Testing for LLM Components

**Intake Agent Mock**:
```typescript
interface MockIntakeAgent {
  mockParse(prompt: string): IntakeAgentOutput;
  mockClarification(prompt: string): ClarificationRequest;
  mockTimeout(prompt: string): void;
}
```

**Workflow Planner Mock**:
```typescript
interface MockWorkflowPlanner {
  mockPlan(objective: StructuredObjective): IR;
  mockInvalidCapability(objective: StructuredObjective): IR;
  mockTimeout(objective: StructuredObjective): void;
}
```

### Test Configuration

- **Unit Tests**: Run on every commit
- **Integration Tests**: Run on PR merge
- **Property Tests**: Minimum 100 iterations per property
- **Timeout Tests**: Verify 30s, 500ms, 200ms timeouts are enforced

### Coverage Requirements

| Component | Target Coverage |
|-----------|-----------------|
| Deterministic Validators | 95% |
| Orchestration Logic | 90% |
| Error Handling | 85% |
| LLM Component Interfaces | 80% |


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

This platform contains both deterministic validators (suitable for property-based testing) and LLM-based components (requiring integration tests). The following properties apply to deterministic components where behavior is fully specified by inputs.

**Property 1: Intake Agent Output Schema Compliance**

*For any* output produced by the Intake Agent, the structured objective SHALL conform to the StructuredObjective JSON schema, with all required fields present and correctly typed.

**Validates: Requirements 1.2**

**Property 2: Capability Vocabulary Closure**

*For any* IR generated by the Workflow Planner, all step types SHALL be members of the closed Capability_Vocabulary set: {Discover, Acquire, Extract, Transform, Enrich, Resolve, Filter, Validate, Provenance, Persist, Deliver}.

**Validates: Requirements 2.1**

**Property 3: IR Connection Validity**

*For any* IR, all connections SHALL reference existing source and target steps, and referenced fields SHALL exist in the corresponding step's output schema.

**Validates: Requirements 2.2**

**Property 4: IR Parameter Completeness**

*For any* IR step, the parameters SHALL include all required parameters defined for that capability type, with correct types.

**Validates: Requirements 2.4**

### Property 5: Structural Check Step Type Validation

*For any* IR input to Structural Check, the validator SHALL accept IRs where all step types are in the Capability_Vocabulary and reject IRs containing invalid step types.

**Validates: Requirements 3.1**

### Property 6: Structural Check Parameter Validation

*For any* IR input to Structural Check, the validator SHALL accept IRs with complete, correctly-typed parameters and reject IRs with missing or incorrectly-typed parameters.

**Validates: Requirements 3.2**

### Property 7: Structural Check Field Reference Validation

*For any* IR input to Structural Check, the validator SHALL accept IRs where all field references exist in upstream step outputs and reject IRs with undefined field references.

**Validates: Requirements 3.3**

### Property 8: Structural Check Error Precision

*For any* invalid IR input to Structural Check, the returned errors SHALL include precise step_id and parameter location information identifying the error source.

**Validates: Requirements 3.4**

### Property 9: Structural Check Pass-Through

*For any* valid IR input to Structural Check, the output verified IR SHALL be structurally equivalent to the input.

**Validates: Requirements 3.6**

### Property 10: Compiler Output Validity

*For any* verified IR input, the Compiler SHALL produce syntactically valid n8n workflow JSON containing a nodes array and connections object.

**Validates: Requirements 4.1**

### Property 11: Compiler Capability Mapping

*For any* IR step, the Compiler SHALL map the capability type to the corresponding n8n node template according to the defined template registry.

**Validates: Requirements 4.2**

### Property 12: Compiler Connection Assembly

*For any* IR connection, the Compiler SHALL generate a valid n8n node linkage connecting the source node output to the target node input.

**Validates: Requirements 4.3**

### Property 13: Compiler Output Completeness

*For any* compilation result, the output SHALL include both the workflow JSON and a template manifest listing all templates used.

**Validates: Requirements 4.6**

### Property 14: Contract Check Set Difference

*For any* workflow with required_fields and final_output_schema, the Contract Check SHALL correctly compute the set difference, returning an empty set when all fields are present and the missing fields otherwise.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 15: Contract Check Provenance Verification

*For any* workflow where provenance is required, the Contract Check SHALL verify the presence of source_url in the final output schema.

**Validates: Requirements 6.4**

### Property 16: Contract Check Certificate Completeness

*For any* workflow that passes contract verification, the returned certificate SHALL list all satisfied required fields.

**Validates: Requirements 6.6**

### Property 17: Repair Attempt Limit

*For any* repair sequence triggered by LOGIC_FAILURE, the total number of repair attempts SHALL NOT exceed 3.

**Validates: Requirements 8.4**

### Property 18: Provenance Metadata Presence

*For any* output record from a workflow, the record SHALL contain a _provenance field with all required metadata.

**Validates: Requirements 11.1, 11.2**

### Property 19: Provenance Source URL Enforcement

*For any* record produced when provenance is required by the objective, the source_url SHALL NOT be null.

**Validates: Requirements 11.3**

### Property 20: Deduplication Correctness

*For any* set of duplicate records (same content fingerprint), the Platform SHALL assign identical dedupe_group values and preserve only the record with the highest extraction_confidence.

**Validates: Requirements 11.4**

### Property 21: Extraction Confidence Range

*For any* extraction_confidence value in provenance metadata, the value SHALL be within the range [0.0, 1.0] with up to 4 decimal places of precision.

**Validates: Requirements 11.5**

### Property 22: Validation Status Enumeration

*For any* validation_status in provenance metadata, the value SHALL be one of: "valid", "invalid:missing_field", "invalid:type_mismatch", or "invalid:constraint_violation".

**Validates: Requirements 11.6**

### Property 23: Failure Classification Completeness

*For any* failure occurring in the Platform, the classification SHALL be exactly one of: LOGIC_FAILURE, INFRASTRUCTURE_FAILURE, or EXTERNAL_SOURCE_UNAVAILABLE.

**Validates: Requirements 13.1**

### Property 24: Data Contract Schema Compatibility

*For any* connection between workflow steps, the Platform SHALL validate that all fields required by the downstream step's input_schema are produced by the upstream step's output_schema.

**Validates: Requirements 14.1, 14.2**

### Property 25: Contract Error Field Specification

*For any* data contract violation, the error message SHALL include the specific field names causing the mismatch.

**Validates: Requirements 14.3**

### Property 26: IR Field Mapping Completeness

*For any* IR generated by the Workflow Planner, there SHALL be explicit field mappings for all step connections.

**Validates: Requirements 14.5**

### Property Consolidation Summary

After reviewing all identified properties, the following consolidations were made:

1. **Properties 6.1, 6.2, 6.3 consolidated into Property 14**: The set difference computation, empty set certification, and non-empty set violation are three aspects of the same mathematical operation. One property covers all three.

2. **Properties 11.1 and 11.2 consolidated into Property 18**: Provenance presence and required fields are tested together.

3. **Properties 14.1 and 14.2 consolidated into Property 24**: Schema compatibility and field verification are the same validation from different perspectives.

### Testing Approach by Component Type

| Component Type | Test Approach | Rationale |
|----------------|---------------|-----------|
| **Deterministic Validators** (Structural Check, Compiler, Contract Check) | Property-based testing (100+ iterations) | Pure functions with well-defined inputs/outputs |
| **LLM Components** (Intake Agent, Workflow Planner, Repair Agent) | Integration tests with mock/real LLM | Non-deterministic behavior, testing prompt-response patterns |
| **External Integrations** (n8n API, Sandbox, Deployment) | Integration tests with fixtures | External service behavior, stateful operations |
| **UI Components** (Dashboard) | Smoke tests + integration tests | Visual rendering, user interactions |
| **Configuration/Constants** | Smoke tests (single execution) | One-time setup verification |
