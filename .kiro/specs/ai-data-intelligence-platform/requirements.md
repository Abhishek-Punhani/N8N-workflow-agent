# Requirements Document

## Introduction

The AI Data Intelligence Platform transforms natural language prompts into source-backed datasets through verified n8n workflows. Users provide prompts like "Find 100 Indian AI startups founded after 2023 with founders, funding, website, and evidence" and the platform automatically generates, verifies, and executes n8n workflows that produce validated, traceable datasets.

The platform employs a three-phase architecture: Plan (LLM-driven objective parsing and workflow planning), Verify (deterministic structural and contract validation with targeted repair), and Run (controlled deployment with full observability and provenance tracking).

## Glossary

- **Platform**: The AI Data Intelligence Platform system that orchestrates the entire workflow from prompt to dataset
- **Intake_Agent**: LLM-based component that transforms raw user prompts into structured objectives
- **Workflow_Planner**: LLM-based component that produces capability graphs using a closed vocabulary
- **IR (Intermediate Representation)**: Capability graph representation of workflows, not n8n JSON
- **Compiler**: Deterministic component that assembles verified IR into n8n workflow JSON
- **Repair_Agent**: LLM-based component that patches failing IR steps based on failure traces
- **n8n_Instance**: The n8n automation platform instance where workflows are deployed and executed
- **Capability_Vocabulary**: Closed set of workflow steps: Discover, Acquire, Extract, Transform, Enrich, Resolve, Filter, Validate, Provenance, Persist, Deliver
- **Structural_Check**: Deterministic validator that type-checks IR for valid step types and parameter completeness
- **Contract_Check**: Deterministic validator that proves workflow output satisfies user requirements via set difference
- **Sandbox**: Isolated execution environment for testing workflows with small fixtures before production deployment
- **Provenance_Metadata**: Source URL, extraction confidence, dedupe group, and validation status attached to each record
- **Dashboard**: Web interface displaying verification stages, record counts, source inspection, history, and export capabilities
- **LOGIC_FAILURE**: Failure classification requiring IR patch (blocks execution)
- **INFRASTRUCTURE_FAILURE**: Failure classification suitable for retry
- **EXTERNAL_SOURCE_UNAVAILABLE**: Failure classification for degraded operation mode
- **Data_Contract**: Schema agreement between workflow steps defining input/output field requirements

## Requirements

### Requirement 1: Natural Language Prompt Intake

**User Story:** As a data analyst, I want to submit natural language prompts describing my data needs, so that the platform can understand and execute my data collection requirements without technical expertise.

#### Acceptance Criteria

1. WHEN a user submits a natural language prompt, THE Intake_Agent SHALL parse it into a structured objective containing target entity, constraints, required fields, data sources, and output requirements
2. WHEN parsing a prompt, THE Intake_Agent SHALL output a schema-constrained JSON object with all required fields populated
3. IF the prompt is ambiguous or incomplete, THE Intake_Agent SHALL return a clarification request with specific questions
4. WHEN a prompt specifies entity count requirements, THE Intake_Agent SHALL extract the exact count or range as a constraint
5. WHERE multiple interpretations exist, THE Intake_Agent SHALL select the most specific interpretation and document the assumption

### Requirement 2: Capability Graph Generation

**User Story:** As a platform operator, I want the system to generate workflow plans using a closed vocabulary of capabilities, so that workflows remain predictable, testable, and maintainable.

#### Acceptance Criteria

1. WHEN the Intake_Agent produces a structured objective, THE Workflow_Planner SHALL generate a capability graph using only steps from the Capability_Vocabulary
2. WHEN generating a capability graph, THE Workflow_Planner SHALL define data-flow contracts between connected steps
3. THE Capability_Vocabulary SHALL contain exactly: Discover, Acquire, Extract, Transform, Enrich, Resolve, Filter, Validate, Provenance, Persist, Deliver
4. WHEN a step requires configuration, THE Workflow_Planner SHALL specify required parameters with their types
5. IF a required capability is not in the vocabulary, THE Workflow_Planner SHALL decompose the requirement into available capabilities
6. WHILE generating the graph, THE Workflow_Planner SHALL minimize step count while satisfying all objective requirements

### Requirement 3: Structural Validation

**User Story:** As a platform operator, I want deterministic validation of workflow plans, so that invalid workflows are caught before expensive compilation and execution.

#### Acceptance Criteria

1. WHEN a capability graph is generated, THE Structural_Check SHALL validate all step types exist in the Capability_Vocabulary
2. WHEN validating a step, THE Structural_Check SHALL verify all required parameters are present and correctly typed
3. WHEN validating field references, THE Structural_Check SHALL confirm all referenced fields exist in upstream step outputs
4. IF structural validation fails, THE Structural_Check SHALL return precise error locations and missing elements
5. THE Structural_Check SHALL complete validation without LLM calls
6. WHEN validation succeeds, THE Structural_Check SHALL return a verified IR ready for compilation

### Requirement 4: Workflow Compilation

**User Story:** As a platform operator, I want automatic conversion of validated plans to n8n workflows, so that LLMs never directly author executable workflow JSON.

#### Acceptance Criteria

1. WHEN the Structural_Check returns a verified IR, THE Compiler SHALL assemble n8n workflow JSON using vetted sub-workflow templates
2. WHEN compiling a step, THE Compiler SHALL map capability types to corresponding n8n node templates
3. WHEN connecting steps, THE Compiler SHALL generate proper n8n node linkages with correct data flow
4. THE Compiler SHALL produce valid n8n workflow JSON accepted by the n8n_Instance API
5. THE Compiler SHALL execute compilation deterministically without LLM calls
6. WHEN compilation completes, THE Compiler SHALL return the workflow JSON and a manifest of included templates

### Requirement 5: Compiled Workflow Validation

**User Story:** As a platform operator, I want validation of compiled n8n workflows, so that malformed workflows are caught before deployment.

#### Acceptance Criteria

1. WHEN the Compiler produces workflow JSON, THE Compiled_Workflow_Check SHALL validate the n8n graph structure
2. WHEN validating, THE Compiled_Workflow_Check SHALL submit the workflow to the n8n_Instance API for schema validation
3. IF the n8n API rejects the workflow, THE Compiled_Workflow_Check SHALL return the API error with specific validation failures
4. WHEN validation succeeds, THE Compiled_Workflow_Check SHALL confirm workflow readiness for sandbox execution
5. THE Compiled_Workflow_Check SHALL complete validation without LLM calls

### Requirement 6: Contract Verification

**User Story:** As a data consumer, I want mathematical proof that workflow outputs satisfy my requirements, so that I can trust the data produced meets my specifications.

#### Acceptance Criteria

1. WHEN a compiled workflow passes validation, THE Contract_Check SHALL compute the set difference between required_fields and final_output_schema
2. WHEN the set difference is empty, THE Contract_Check SHALL certify the workflow satisfies all user requirements
3. IF the set difference is non-empty, THE Contract_Check SHALL return the missing fields as contract violations
4. THE Contract_Check SHALL verify provenance requirements by confirming source_url field inclusion when provenance is required
5. THE Contract_Check SHALL complete verification without LLM calls
6. WHEN contract verification succeeds, THE Contract_Check SHALL return a contract certificate listing all satisfied requirements

### Requirement 7: Sandbox Execution

**User Story:** As a platform operator, I want safe trial execution of workflows, so that logic errors are caught before production deployment.

#### Acceptance Criteria

1. WHEN contract verification succeeds, THE Sandbox SHALL execute the workflow against small test fixtures
2. WHEN executing, THE Sandbox SHALL enforce a timeout to prevent runaway workflows
3. WHEN a workflow fails, THE Sandbox SHALL classify the failure as LOGIC_FAILURE, INFRASTRUCTURE_FAILURE, or EXTERNAL_SOURCE_UNAVAILABLE
4. IF failure classification is LOGIC_FAILURE, THE Sandbox SHALL capture the exact failure trace for the Repair_Agent
5. IF failure classification is INFRASTRUCTURE_FAILURE, THE Sandbox SHALL retry execution up to 2 times
6. IF failure classification is EXTERNAL_SOURCE_UNAVAILABLE, THE Sandbox SHALL mark the workflow for degraded mode operation
7. WHEN sandbox execution succeeds, THE Sandbox SHALL return sample output records for validation

### Requirement 8: Automated Repair Loop

**User Story:** As a platform operator, I want automatic repair of logic failures, so that workflows can self-correct without manual intervention.

#### Acceptance Criteria

1. WHEN the Sandbox classifies a failure as LOGIC_FAILURE, THE Repair_Agent SHALL receive the failure trace and original IR
2. WHEN analyzing a failure, THE Repair_Agent SHALL identify the specific failing step and root cause
3. WHEN repairing, THE Repair_Agent SHALL patch only the failing step or its immediate dependencies
4. THE Repair_Agent SHALL attempt repair a maximum of 3 times before escalating to manual intervention
5. IF repair succeeds, THE Repair_Agent SHALL return the patched IR for re-validation
6. IF repair attempts are exhausted, THE Repair_Agent SHALL return a detailed failure report with attempted patches

### Requirement 9: Workflow Deployment

**User Story:** As a data analyst, I want verified workflows deployed automatically, so that I can execute data collection without manual setup.

#### Acceptance Criteria

1. WHEN sandbox execution succeeds, THE Platform SHALL deploy the workflow to the n8n_Instance
2. WHEN deploying, THE Platform SHALL resolve and inject required credentials for external data sources
3. WHEN deployment completes, THE Platform SHALL activate the workflow for execution
4. IF credential resolution fails, THE Platform SHALL return a credential error with specific missing credentials
5. THE Platform SHALL record the deployment with timestamp, workflow ID, and configuration manifest

### Requirement 10: Execution Observability

**User Story:** As a platform operator, I want real-time visibility into workflow execution, so that I can monitor progress and diagnose issues.

#### Acceptance Criteria

1. WHEN a workflow executes, THE Platform SHALL capture node-level status via webhooks from the n8n_Instance
2. WHEN a node fails, THE Platform SHALL trigger error handlers and record the failure context
3. WHILE execution is in progress, THE Platform SHALL provide reconciliation polls to detect stalled workflows
4. WHEN execution completes, THE Platform SHALL record final status, record count, and execution duration
5. IF execution exceeds expected duration, THE Platform SHALL flag the workflow for investigation
6. THE Platform SHALL expose execution status through a queryable API

### Requirement 11: Provenance and Data Quality

**User Story:** As a data consumer, I want every record to include source traceability and quality metadata, so that I can verify data authenticity and reliability.

#### Acceptance Criteria

1. WHEN a workflow produces output records, THE Platform SHALL attach provenance metadata to each record
2. THE Provenance_Metadata SHALL include source_url, extraction_confidence, dedupe_group, and validation_status
3. WHEN provenance is required by the objective, THE Platform SHALL enforce source_url presence and reject records with null source_url
4. WHEN duplicate records are detected, THE Platform SHALL assign identical dedupe_group values and preserve only the highest confidence record
5. THE extraction_confidence SHALL be a numeric value between 0.0 and 1.0 indicating extraction reliability
6. WHEN a record fails validation, THE validation_status SHALL indicate the specific validation failure type

### Requirement 12: Dashboard Interface

**User Story:** As a data analyst, I want a visual dashboard to monitor workflow status and inspect results, so that I can track progress and access my datasets.

#### Acceptance Criteria

1. WHEN a user accesses the Dashboard, THE Dashboard SHALL display all verification stages as independent pass/fail indicators
2. WHEN displaying execution results, THE Dashboard SHALL show record counts, execution duration, and status
3. WHEN a user selects a record, THE Dashboard SHALL display the source URL and provenance metadata for inspection
4. THE Dashboard SHALL display execution history with timestamps and workflow identifiers
5. WHEN a user requests export, THE Dashboard SHALL generate downloadable datasets in CSV and JSON formats
6. THE Dashboard SHALL read all display data from the Platform database without direct workflow access

### Requirement 13: Failure Classification and Handling

**User Story:** As a platform operator, I want precise failure classification with appropriate handling strategies, so that the platform can recover from errors gracefully.

#### Acceptance Criteria

1. WHEN a failure occurs, THE Platform SHALL classify it as LOGIC_FAILURE, INFRASTRUCTURE_FAILURE, or EXTERNAL_SOURCE_UNAVAILABLE
2. IF classification is LOGIC_FAILURE, THE Platform SHALL trigger the Repair_Agent and block further execution
3. IF classification is INFRASTRUCTURE_FAILURE, THE Platform SHALL retry the operation with exponential backoff up to 3 attempts
4. IF classification is EXTERNAL_SOURCE_UNAVAILABLE, THE Platform SHALL mark affected data sources as degraded and continue with available sources
5. THE Platform SHALL log all failure classifications with timestamps, error messages, and handling actions
6. WHEN degraded mode is active, THE Platform SHALL indicate degraded status in the Dashboard with affected source list

### Requirement 14: Data Contract Enforcement

**User Story:** As a platform operator, I want strict enforcement of data contracts between workflow steps, so that data flows correctly through the pipeline.

#### Acceptance Criteria

1. WHEN connecting workflow steps, THE Platform SHALL validate the data contract between output schema and input schema
2. IF an output field is required by a downstream step, THE Platform SHALL verify the upstream step produces that field
3. WHEN a data contract is violated, THE Platform SHALL return a contract error with specific field mismatches
4. THE Platform SHALL maintain a schema registry of all step input/output contracts
5. WHEN the IR is generated, THE Workflow_Planner SHALL include explicit field mappings for each step connection
