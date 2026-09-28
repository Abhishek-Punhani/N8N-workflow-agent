/**
 * AI Data Intelligence Platform - Configuration
 * Core configuration including timeouts and error recovery strategies
 */

// ============================================================================
// Timeout Configuration
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

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  IntakeAgent: 30000, // 30 seconds
  WorkflowPlanner: 30000, // 30 seconds
  StructuralCheck: 500, // 500 milliseconds
  Compiler: 500, // 500 milliseconds
  CompiledWorkflowCheck: 500, // 500 milliseconds
  ContractCheck: 200, // 200 milliseconds
  Sandbox: 30000, // 30 seconds (configurable)
};

// ============================================================================
// Error Recovery Strategies
// ============================================================================

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

export const DEFAULT_RECOVERY_STRATEGIES: ErrorRecoveryConfig = {
  retry: {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
    retryableErrorTypes: ['InfrastructureFailureError', 'ExternalSourceUnavailableError'],
  },
  degradation: {
    enabled: true,
    fallbackMode: true,
    maxDegradedSources: 3,
    alertThreshold: 2,
  },
  repair: {
    maxAttempts: 3,
    maxPatchSize: 5,
    requireManualEscalation: true,
    repairAgentTimeout: 30000, // 30 seconds
  },
  classification: {
    logicFailure: [
      'InvalidStepTypeError',
      'MissingParameterError',
      'UndefinedFieldReferenceError',
      'TemplateNotFoundError',
      'NodeAssemblyError',
      'MissingFieldError',
      'LogicFailureError',
    ],
    infrastructureFailure: ['InfrastructureFailureError', 'ExternalSourceUnavailableError'],
    externalSourceUnavailable: ['ExternalSourceUnavailableError'],
  },
};

// ============================================================================
// Error Thresholds
// ============================================================================

export interface ErrorThresholds {
  maxConsecutiveFailures: number;
  failureWindowMs: number;
  alertCooldownMs: number;
  maxErrorPayloadSize: number;
}

export const DEFAULT_ERROR_THRESHOLDS: ErrorThresholds = {
  maxConsecutiveFailures: 5,
  failureWindowMs: 60000, // 1 minute
  alertCooldownMs: 300000, // 5 minutes
  maxErrorPayloadSize: 10000, // 10KB
};

// ============================================================================
// Timeout Utility Functions
// ============================================================================

export function getTimeoutForComponent(component: string): number | undefined {
  return DEFAULT_TIMEOUTS[component as keyof TimeoutConfig];
}

export function validateTimeout(timeout: number, min: number, max: number): boolean {
  return timeout >= min && timeout <= max;
}

export function formatTimeout(timeoutMs: number): string {
  if (timeoutMs < 1000) {
    return `${timeoutMs}ms`;
  }
  if (timeoutMs < 60000) {
    return `${(timeoutMs / 1000).toFixed(1)}s`;
  }
  return `${(timeoutMs / 60000).toFixed(1)}m`;
}

export function createTimeoutHandler(component: string, timeoutMs: number): NodeJS.Timeout {
  return setTimeout(() => {
    throw new Error(`Timeout exceeded for ${component}`);
  }, timeoutMs);
}

// ============================================================================
// Retry Utility Functions
// ============================================================================

export function calculateBackoffDelay(
  attemptNumber: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number
): number {
  const delay = initialDelay * Math.pow(backoffMultiplier, attemptNumber - 1);
  return Math.min(delay, maxDelay);
}

export function shouldRetryAttempt(attemptNumber: number, maxRetries: number): boolean {
  return attemptNumber <= maxRetries;
}

// ============================================================================
// Export Configuration
// ============================================================================

export const Config = {
  timeouts: DEFAULT_TIMEOUTS,
  recoveryStrategies: DEFAULT_RECOVERY_STRATEGIES,
  errorThresholds: DEFAULT_ERROR_THRESHOLDS,
} as const;

export type Config = typeof Config;
