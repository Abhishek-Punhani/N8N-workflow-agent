/**
 * AI Data Intelligence Platform - Run Module Type Definitions
 */

import {
  N8NWorkflow,
  DeploymentRecord,
  FailureClassification,
  FailureTrace,
  CredentialRequirement,
  DeploymentErrorInfo,
} from '@core/types.js';

// ============================================================================
// Sandbox Types
// ============================================================================

export interface SandboxInput {
  workflow_json: N8NWorkflow;
  test_fixtures?: TestFixture[];
  timeout_ms?: number;
}

export interface SandboxResult {
  status: 'success' | 'failure';
  sample_output?: Record<string, any>[];
  failure_classification?: FailureClassification;
  failure_trace?: FailureTrace;
  executed_at: string;
}

export interface TestFixture {
  step_id: string;
  mock_data: Record<string, any>[];
}

// ============================================================================
// Failure Classification Types
// ============================================================================

export interface FailureClassifierInput {
  error: Error;
  step_id: string;
  retry_count: number;
}

export interface FailureClassificationResult {
  classification: FailureClassification;
  trace: FailureTrace;
  recommended_action: 'retry' | 'repair' | 'degraded' | 'escalate';
}

// ============================================================================
// Deployer Types
// ============================================================================

export interface DeployerInput {
  workflow_json: N8NWorkflow;
  credential_requirements: CredentialRequirement[];
}

export interface DeployerResult {
  status: 'deployed' | 'error';
  record?: DeploymentRecord;
  error?: DeploymentErrorInfo;
  deployed_at: string;
}

// ============================================================================
// Retry Handler Types
// ============================================================================

export interface RetryConfig {
  max_retries: number;
  base_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
}

export interface RetryResult {
  succeeded: boolean;
  attempt: number;
  total_delay_ms: number;
}

// ============================================================================
// Degraded Mode Types
// ============================================================================

export interface DegradedSource {
  source_id: string;
  source_type: string;
  last_available?: string;
  status: 'available' | 'degraded' | 'unavailable';
}

export interface DegradedModeConfig {
  enabled: boolean;
  sources: Record<string, DegradedSource>;
  allow_partial_results: boolean;
}

// ============================================================================
// Timeout Configuration
// ============================================================================

export const RUN_TIMEOUTS = {
  SANDBOX_DEFAULT: 30_000, // 30 seconds
  DEPLOYMENT: 60_000, // 60 seconds
  RETRY_BASE_DELAY: 1000, // 1 second
  RETRY_MAX_DELAY: 30_000, // 30 seconds
};
