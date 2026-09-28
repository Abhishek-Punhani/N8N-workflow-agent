/**
 * AI Data Intelligence Platform - Verify Module Type Definitions
 */

import {
  IR,
  VerifiedIR,
  ValidatedWorkflow,
  N8NValidationError,
  N8NWorkflow,
  StructuralError,
  TemplateManifest,
} from '@core/types.js';

// ============================================================================
// Structural Check Types
// ============================================================================

export interface StructuralCheckInput {
  ir: IR;
}

export interface StructuralCheckResult {
  status: 'valid' | 'invalid';
  verified_ir?: VerifiedIR;
  errors?: StructuralError[];
}

// ============================================================================
// Compiler Types
// ============================================================================

export interface CompilerInput {
  verified_ir: VerifiedIR;
}

export interface CompilerResult {
  status: 'success' | 'error';
  workflow_json?: N8NWorkflow;
  manifest?: TemplateManifest;
  errors?: string[];
}

// ============================================================================
// Compiled Workflow Check Types
// ============================================================================

export interface CompiledWorkflowCheckInput {
  workflow_json: N8NWorkflow;
}

export interface CompiledWorkflowCheckResult {
  status: 'valid' | 'invalid';
  validated_workflow?: ValidatedWorkflow;
  errors?: N8NValidationError[];
}

// ============================================================================
// Contract Check Types
// ============================================================================

export interface ContractCheckInput {
  workflow_json: N8NWorkflow;
  required_fields: any[]; // FieldDefinition[]
  provenance_required: boolean;
}

export type ContractCheckInputType = ContractCheckInput;

// ============================================================================
// Verification Pipeline Types
// ============================================================================

export interface VerificationStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  errors?: any[];
  started_at?: string;
  completed_at?: string;
}

export interface VerificationResult {
  ir: IR;
  stage_status: Record<string, VerificationStage['status']>;
  stages: VerificationStage[];
  certified: boolean;
  errors: any[];
  verification_timestamp: string;
}

// ============================================================================
// Timeout Configuration
// ============================================================================

export const VERIFY_TIMEOUTS = {
  STRUCTURAL_CHECK: 500, // 500ms
  COMPILER: 500, // 500ms
  COMPILED_WORKFLOW_CHECK: 500, // 500ms
  CONTRACT_CHECK: 200, // 200ms
};
