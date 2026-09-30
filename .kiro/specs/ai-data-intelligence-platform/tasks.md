# Implementation Plan: AI Data Intelligence Platform

## Overview

This implementation follows a three-phase architecture (Plan, Verify, Run) that transforms natural language prompts into source-backed datasets through verified n8n workflows. The platform separates LLM reasoning from deterministic validation, ensuring workflows are verifiable, secure, and maintainable.

**Implementation Strategy**: Build foundational infrastructure first (IR schema, capability vocabulary), then deterministic validators (with property-based tests), followed by LLM components, and finally observability and UI.

**Tech Stack**: TypeScript for all components, property-based testing for deterministic validators (26 properties defined).

## Tasks

### 1. Foundational Infrastructure

- [x] 1.1 Create project structure and core type definitions
  - Set up TypeScript project with tsconfig.json, ESLint, and Prettier
  - Define directory structure: `/src/{core,plan,verify,run,observability,dashboard}`
  - Create core type definitions for IR, StructuredObjective, Capability types
  - Implement JSON schemas for UserPrompt, StructuredObjective, IR, ProvenanceMetadata
  - _Requirements: 2.3, 14.4_

- [x] 1.2 Implement Capability Vocabulary and Template Registry
  - Define CapabilityType enum with 11 types (Discover, Acquire, Extract, Transform, Enrich, Resolve, Filter, Validate, Provenance, Persist, Deliver)
  - Create CapabilityDefinition interface with required parameters and schemas for each type
  - Implement Template Registry mapping capability types to n8n node templates (11 template IDs)
  - Add template validation functions
  - _Requirements: 2.1, 2.3, 4.1, 4.2_

- [x] 1.3 Implement error hierarchy and classification
  - Create base PlatformError class and specialized error types (PlanningError, ValidationError, ExecutionError, DeploymentError)
  - Implement FailureClassification enum (LOGIC_FAILURE, INFRASTRUCTURE_FAILURE, EXTERNAL_SOURCE_UNAVAILABLE)
  - Create ErrorResponse interface and error formatting utilities
  - Add timeout configuration and error recovery strategies
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

### 2. Phase 2: Deterministic Validators (VERIFY Phase)

- [ ] 2.1 Implement Structural Check validator
  - Create StructuralCheck class with validate() method
  - Implement step type validation against Capability Vocabulary
  - Add parameter completeness and type checking logic
  - Implement field reference validation (check upstream outputs)
  - Add connection validity checks
  - Return precise error locations with step_id and parameter paths
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

- [ ]* 2.2 Write property tests for Structural Check (Properties 5-9)
  - **Property 5: Step Type Validation** - Accept valid IRs, reject invalid step types
  - **Property 6: Parameter Validation** - Accept complete parameters, reject missing/incorrect types
  - **Property 7: Field Reference Validation** - Accept valid field refs, reject undefined refs
  - **Property 8: Error Precision** - Verify errors include precise step_id and location
  - **Property 9: Pass-Through** - Verify valid IR passes through unchanged
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**

- [x] 2.3 Implement Compiler (IR to n8n workflow)
  - Create Compiler class with compile() method accepting verified IR
  - Implement capability-to-template mapping using Template Registry
  - Build n8n node assembly logic with proper parameter injection
  - Generate n8n connections from IR connections
  - Create TemplateManifest with used templates and metadata
  - Return N8NWorkflow JSON and manifest
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

- [x]* 2.4 Write property tests for Compiler (Properties 10-13)
  - **Property 10: Output Validity** - Produce syntactically valid n8n JSON with nodes and connections
  - **Property 11: Capability Mapping** - Map capability types to correct n8n templates
  - **Property 12: Connection Assembly** - Generate valid n8n linkages from IR connections
  - **Property 13: Output Completeness** - Include workflow JSON and template manifest
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.6**

- [ ] 2.5 Implement Compiled Workflow Check
  - Create CompiledWorkflowCheck class with validate() method
  - Implement n8n API client for workflow validation endpoint
  - Parse and structure n8n validation errors with node_id and error_code
  - Return validated workflow or N8NValidationError array
  - Add retry logic for transient API failures
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 2.6 Write integration tests for Compiled Workflow Check
  - Test valid workflow acceptance by n8n API
  - Test invalid workflow rejection with proper error capture
  - Test API timeout handling
  - Mock n8n API responses for deterministic testing
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 2.7 Implement Contract Check validator
  - Create ContractCheck class with verify() method
  - Implement set difference algorithm (required_fields - final_output_schema.fields)
  - Add provenance verification (source_url presence check)
  - Generate ContractCertificate for satisfied contracts
  - Return ContractViolation array for missing fields with required_by references
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

- [ ]* 2.8 Write property tests for Contract Check (Properties 14-16)
  - **Property 14: Set Difference** - Correctly compute missing fields, return empty set when complete
  - **Property 15: Provenance Verification** - Verify source_url presence when provenance required
  - **Property 16: Certificate Completeness** - List all satisfied fields in certificate
  - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6**

- [ ] 2.9 Checkpoint: Verify all deterministic validators pass property tests
  - Ensure all tests pass, ask the user if questions arise.

### 3. Sandbox Execution Environment

- [ ] 3.1 Implement Sandbox executor
  - Create Sandbox class with execute() method accepting workflow JSON and test fixtures
  - Set up isolated execution environment (Docker container or process isolation)
  - Implement timeout enforcement with configurable limits
  - Capture execution output and failure traces
  - _Requirements: 7.1, 7.2, 7.7_

- [ ] 3.2 Implement failure classification logic
  - Create FailureClassifier with classify() method
  - Implement classification rules for LOGIC_FAILURE (incorrect workflow logic)
  - Add INFRASTRUCTURE_FAILURE detection (timeouts, network issues)
  - Add EXTERNAL_SOURCE_UNAVAILABLE detection (HTTP 404, 503, DNS failures)
  - Capture detailed failure traces with step_id, error_message, stack_trace
  - _Requirements: 7.3, 7.4, 7.5, 7.6, 13.1_

- [x]* 3.3 Write integration tests for Sandbox
  - Test successful execution with sample output
  - Test LOGIC_FAILURE classification and trace capture
  - Test INFRASTRUCTURE_FAILURE retry logic (exponential backoff, max 3 attempts)
  - Test EXTERNAL_SOURCE_UNAVAILABLE degraded mode
  - Test timeout enforcement
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 3.4 Implement retry and degraded mode handlers
  - Create RetryHandler with exponential backoff (up to 3 retries for INFRASTRUCTURE_FAILURE)
  - Implement DegradedModeManager to track unavailable sources
  - Add source availability tracking and status reporting
  - _Requirements: 7.5, 7.6, 13.3, 13.4, 13.6_

### 4. Phase 1: LLM Components (PLAN Phase)

- [x] 4.1 Implement Intake Agent (LLM-based)
  - Create IntakeAgent class with parse() method accepting user prompt
  - Implement LLM client with schema-constrained output (JSON mode)
  - Define prompt template extracting target_entity, constraints, required_fields, data_sources
  - Add clarification request generation for ambiguous prompts
  - Implement assumption documentation for multiple interpretations
  - Add 30-second timeout enforcement
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x]* 4.2 Write property tests for Intake Agent (Property 1)
  - **Property 1: Output Schema Compliance** - Verify StructuredObjective conforms to JSON schema
  - **Validates: Requirements 1.2**

- [ ]* 4.3 Write unit tests for Intake Agent
  - Test empty prompt handling
  - Test maximum prompt length (10,000 characters)
  - Test constraint extraction (equals, contains, greater_than, less_than, between, in)
  - Test clarification request generation
  - Test timeout behavior (30s)
  - Mock LLM responses for deterministic testing
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 4.4 Implement Workflow Planner (LLM-based)
  - Create WorkflowPlanner class with plan() method accepting StructuredObjective
  - Implement LLM client with capability vocabulary constraints
  - Define prompt template for IR generation with step types, connections, field mappings
  - Add data contract definition between connected steps
  - Implement step minimization logic (fewest steps satisfying requirements)
  - Add 30-second timeout enforcement
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

- [ ]* 4.5 Write property tests for Workflow Planner (Properties 2-4)
  - **Property 2: Capability Vocabulary Closure** - All step types in closed vocabulary
  - **Property 3: IR Connection Validity** - All connections reference existing steps with valid fields
  - **Property 4: IR Parameter Completeness** - All required parameters present with correct types
  - **Validates: Requirements 2.1, 2.2, 2.4**

- [ ]* 4.6 Write unit tests for Workflow Planner
  - Test capability graph generation for sample objectives
  - Test data contract creation between steps
  - Test step minimization
  - Test handling of capabilities not in vocabulary (decomposition)
  - Test timeout behavior (30s)
  - Mock LLM responses for deterministic testing
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

- [ ] 4.7 Implement Repair Agent (LLM-based)
  - Create RepairAgent class with repair() method accepting FailureTrace and original IR
  - Implement LLM client for IR patching with failure context
  - Add attempt counter (max 3 attempts)
  - Generate patch descriptions explaining changes
  - Create escalation reports after exhausted attempts with all attempted patches
  - Add 30-second timeout per repair attempt
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ]* 4.8 Write property tests for Repair Agent (Property 17)
  - **Property 17: Repair Attempt Limit** - Never exceed 3 repair attempts
  - **Validates: Requirements 8.4**

- [ ]* 4.9 Write unit tests for Repair Agent
  - Test single repair attempt with success
  - Test multiple repair attempts (2-3) with eventual success
  - Test escalation after 3 failed attempts
  - Test patch description generation
  - Test escalation report completeness
  - Mock LLM responses for deterministic testing
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 4.10 Checkpoint: Verify all LLM components integrate with verification pipeline
  - Ensure all tests pass, ask the user if questions arise.

### 5. Phase 3: Deployment and Execution (RUN Phase)

- [ ] 5.1 Implement Deployer orchestrator
  - Create Deployer class with deploy() method accepting deploy-ready workflow JSON
  - Implement n8n API client for workflow creation and activation
  - Add credential resolution and injection logic
  - Record deployment with DeploymentRecord (deployment_id, workflow_id, timestamp, manifest)
  - Handle credential missing errors with specific credential names
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ]* 5.2 Write integration tests for Deployer
  - Test successful workflow deployment to n8n
  - Test workflow activation
  - Test credential resolution and injection
  - Test credential missing error handling
  - Test deployment record generation
  - Mock n8n API for deterministic testing
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

### 6. Provenance and Data Quality System

- [ ] 6.1 Implement Provenance System
  - Create ProvenanceSystem class with enrich() method accepting records
  - Implement provenance metadata attachment (source_url, extraction_confidence, dedupe_group, validation_status)
  - Add deduplication logic using content fingerprinting (SHA-256 of normalized content)
  - Implement duplicate group selection (highest extraction_confidence wins)
  - Add source_url null rejection when provenance is required
  - Validate extraction_confidence range [0.0, 1.0] with 4 decimal precision
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ]* 6.2 Write property tests for Provenance System (Properties 18-22)
  - **Property 18: Provenance Metadata Presence** - All records have _provenance field with required metadata
  - **Property 19: Source URL Enforcement** - source_url not null when provenance required
  - **Property 20: Deduplication Correctness** - Identical dedupe_group for duplicates, preserve highest confidence
  - **Property 21: Extraction Confidence Range** - Values in [0.0, 1.0] with max 4 decimals
  - **Property 22: Validation Status Enumeration** - Value is one of 4 valid enum values
  - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**

### 7. Data Contract Enforcement

- [ ] 7.1 Implement Data Contract validator
  - Create DataContractValidator class with validate() method accepting upstream and downstream schemas
  - Implement schema compatibility checking (upstream output_schema vs downstream input_schema)
  - Verify all required downstream fields are produced by upstream
  - Generate detailed contract errors with specific field mismatches
  - Integrate with IR field_mappings for explicit contract verification
  - _Requirements: 14.1, 14.2, 14.3, 14.5_

- [ ]* 7.2 Write property tests for Data Contract validator (Properties 24-26)
  - **Property 24: Schema Compatibility** - Validate required fields produced by upstream
  - **Property 25: Contract Error Field Specification** - Errors include specific field names
  - **Property 26: IR Field Mapping Completeness** - Explicit mappings for all connections
  - **Validates: Requirements 14.1, 14.2, 14.3, 14.5**

### 8. Observability Layer

- [ ] 8.1 Implement Observability service
  - Create ObservabilityService class with webhook and polling mechanisms
  - Implement webhook endpoint for n8n node-level status updates
  - Add reconciliation polling to detect stalled workflows
  - Implement duration tracking and threshold flagging
  - Create ExecutionStatus tracking with node-level statuses
  - Expose queryable Status API for execution state
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ]* 8.2 Write integration tests for Observability
  - Test webhook reception and processing
  - Test reconciliation poll detection of stalled workflows
  - Test duration tracking and flagging
  - Test Status API queries
  - Mock n8n webhook payloads for testing
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

### 9. Dashboard Interface

- [ ] 9.1 Set up dashboard frontend project
  - Initialize React/Vue/Angular project with TypeScript
  - Set up routing and state management
  - Create API client for Status API integration
  - Implement authentication and authorization
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 9.2 Implement verification stages visualization
  - Create VerificationStages component displaying pass/fail indicators
  - Show independent status for each stage (Structural Check, Compiler, Contract Check, Sandbox)
  - Display timestamps and error details for failed stages
  - Add visual progress indicators
  - _Requirements: 12.1_

- [ ] 9.3 Implement execution results display
  - Create ExecutionResults component showing record counts and duration
  - Display workflow status and execution history
  - Show timestamps and workflow identifiers
  - Add filtering and sorting capabilities
  - _Requirements: 12.2, 12.4_

- [ ] 9.4 Implement record inspection interface
  - Create RecordInspection component for viewing individual records
  - Display source URL and provenance metadata (_provenance field)
  - Add pagination (client-side and server-side)
  - Implement record detail modal with all fields
  - _Requirements: 12.3_

- [ ] 9.5 Implement data export functionality
  - Create ExportManager with CSV and JSON format support
  - Enforce export limits (1M records, 500MB max size)
  - Generate downloadable files with progress indication
  - Add export history tracking
  - _Requirements: 12.5_

- [ ] 9.6 Implement degraded mode indicators
  - Add visual indicators for degraded workflows
  - Display affected data source list
  - Show source availability status
  - _Requirements: 13.6_

- [ ]* 9.7 Write integration tests for Dashboard
  - Test verification stages display with mock data
  - Test execution results rendering
  - Test record inspection and pagination
  - Test export generation within limits
  - Test degraded mode indicator display
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.6_

### 10. End-to-End Integration and Orchestration

- [ ] 10.1 Implement main orchestration pipeline
  - Create PlatformOrchestrator class coordinating all phases (Plan → Verify → Run)
  - Wire Intake Agent → Workflow Planner → Structural Check → Compiler → Compiled Workflow Check → Contract Check → Sandbox → Deployer
  - Add Repair Agent integration on LOGIC_FAILURE (max 3 attempts)
  - Implement phase transition logic with error handling
  - Add logging and telemetry for all phase transitions
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

- [ ] 10.2 Implement state management and persistence
  - Create database schema for UserPrompt, StructuredObjective, IR, DeployedWorkflow, Execution, Record, Provenance entities
  - Implement repository layer for all entities
  - Add transaction management for multi-step operations
  - Implement state recovery for interrupted workflows
  - _Requirements: 9.5, 10.4, 11.1, 12.2, 12.4_

- [ ]* 10.3 Write end-to-end integration tests
  - Test complete flow: prompt → IR → workflow → deployment → execution
  - Test repair loop with LOGIC_FAILURE scenarios
  - Test retry logic with INFRASTRUCTURE_FAILURE scenarios
  - Test degraded mode with EXTERNAL_SOURCE_UNAVAILABLE scenarios
  - Test multiple workflows executing concurrently
  - Use real n8n instance with test credentials
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

### 11. Configuration and Deployment

- [ ] 11.1 Set up configuration management
  - Create configuration schema for LLM endpoints, n8n API, timeouts, limits
  - Implement environment-specific configs (dev, staging, production)
  - Add configuration validation on startup
  - Document all configuration options
  - _Requirements: All timeout and limit requirements_

- [ ] 11.2 Create deployment infrastructure
  - Write Dockerfile for platform services
  - Create docker-compose.yml with all services (platform, n8n, database, observability)
  - Add Kubernetes manifests for production deployment
  - Implement health check endpoints
  - _Requirements: 9.1, 9.2, 9.3, 10.1_

- [ ] 11.3 Write deployment documentation
  - Document installation and setup process
  - Create API documentation (OpenAPI/Swagger)
  - Write user guide for Dashboard usage
  - Document troubleshooting procedures
  - Add examples of common prompts and expected workflows
  - _Requirements: 1.1, 12.1, 12.2, 12.3, 12.4, 12.5_

### 12. Final Testing and Validation

- [ ] 12.1 Run comprehensive test suite
  - Execute all property-based tests (100+ iterations each)
  - Run all unit tests
  - Execute all integration tests
  - Run end-to-end tests
  - Generate coverage report (target: 90%+ for deterministic components)
  - _Requirements: All_

- [ ] 12.2 Perform performance testing
  - Test platform throughput (concurrent prompt handling)
  - Measure validation pipeline latency
  - Test large dataset handling (approaching 1M records, 500MB limits)
  - Profile LLM component timeout behavior
  - _Requirements: 10.4, 12.5_

- [ ] 12.3 Conduct security review
  - Review credential handling and injection
  - Audit LLM prompt injection vulnerabilities
  - Test sandbox isolation
  - Review error messages for information leakage
  - _Requirements: 9.2, 9.4_

- [ ] 12.4 Final checkpoint: Platform ready for deployment
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **Tasks marked with `*` are optional** and can be skipped for faster MVP. However, property-based tests provide strong correctness guarantees and are highly recommended for deterministic validators.
- **Property-based testing library**: Use `fast-check` for TypeScript property-based testing (100+ iterations per property).
- **LLM Integration**: Use OpenAI API or compatible endpoint with JSON mode support for schema-constrained output.
- **n8n Instance**: Requires n8n instance (self-hosted or cloud) with API access for workflow deployment and execution.
- **Database**: Postgres recommended for production, SQLite acceptable for development.
- **Testing Philosophy**: Deterministic validators use property-based tests (26 properties), LLM components use integration tests with mocked responses, external integrations use fixtures.
- **Repair Agent**: Maximum 3 attempts enforced by orchestrator, not the agent itself.
- **Failure Classification**: Critical for determining retry vs repair vs degraded mode strategies.
- **Provenance**: Attached to every record, enforced when required by objective.
- **Export Limits**: Hard limits (1M records, 500MB) enforced in Dashboard export functionality.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "4.1", "4.4"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.2", "4.3", "4.5", "4.6"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.7"] },
    { "id": 4, "tasks": ["2.6", "2.7", "4.8", "4.9"] },
    { "id": 5, "tasks": ["2.8", "3.1"] },
    { "id": 6, "tasks": ["3.2", "7.1"] },
    { "id": 7, "tasks": ["3.3", "3.4", "7.2"] },
    { "id": 8, "tasks": ["5.1", "6.1"] },
    { "id": 9, "tasks": ["5.2", "6.2", "8.1"] },
    { "id": 10, "tasks": ["8.2", "9.1"] },
    { "id": 11, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 12, "tasks": ["9.7", "10.1"] },
    { "id": 13, "tasks": ["10.2"] },
    { "id": 14, "tasks": ["10.3", "11.1"] },
    { "id": 15, "tasks": ["11.2", "11.3"] },
    { "id": 16, "tasks": ["12.1", "12.2", "12.3"] }
  ]
}
```
