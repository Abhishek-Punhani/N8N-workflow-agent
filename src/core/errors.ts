/**
 * AI Data Intelligence Platform - Error Hierarchy
 * Comprehensive error types with retryability and classification support
 */

// ============================================================================
// Failure Classification
// ============================================================================

/**
 * Failure classification for execution errors
 * Determines appropriate handling strategy:
 * - LOGIC_FAILURE: Block execution, trigger Repair Agent, max 3 retries
 * - INFRASTRUCTURE_FAILURE: Retry with exponential backoff, up to 3 times
 * - EXTERNAL_SOURCE_FAILURE: External data source issues (see ExternalSourceFailureReason)
 */
export enum FailureClassification {
  LOGIC_FAILURE = 'LOGIC_FAILURE',
  INFRASTRUCTURE_FAILURE = 'INFRASTRUCTURE_FAILURE',
  EXTERNAL_SOURCE_FAILURE = 'EXTERNAL_SOURCE_FAILURE',
}

/**
 * Detailed reasons fo/r EXTERNAL_SOURCE_FAILURE
 *
 * Enables fine-grained handling strategies:
 * - RATE_LIMITED: HTTP 429, wait + retry with backoff (read Retry-After header)
 * - CAPTCHA: Human verification required, don't retry, mark source blocked
 * - BOT_BLOCKED: Anti-automation detected, mark source unavailable, switch to alternative
 * - AUTH_REQUIRED: 401/403, resolve credentials or mark unauthorized
 * - NOT_FOUND: 404, remove source from workflow
 * - SOURCE_DOWN: 503, retry with exponential backoff
 * - ROBOTS_RESTRICTED: robots.txt violation, respect policy, switch source
 * - TIMEOUT: Request timeout, retry with longer timeout or mark slow
 * - UNKNOWN: Unclassified external failure
 */
export enum ExternalSourceFailureReason {
  RATE_LIMITED = 'RATE_LIMITED',
  CAPTCHA = 'CAPTCHA',
  BOT_BLOCKED = 'BOT_BLOCKED',
  ROBOTS_RESTRICTED = 'ROBOTS_RESTRICTED',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  NOT_FOUND = 'NOT_FOUND',
  SOURCE_DOWN = 'SOURCE_DOWN',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

// ============================================================================
// Timeout Configuration
// ============================================================================

/**
 * Timeout configurations for different platform components (in milliseconds)
 */
export interface TimeoutConfig {
  intakeAgent: number;
  workflowPlanner: number;
  structuralCheck: number;
  compiler: number;
  compiledWorkflowCheck: number;
  contractCheck: number;
  sandbox: number;
  repairAgent: number;
}

/**
 * Default timeout configuration
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  intakeAgent: 30000, // 30 seconds
  workflowPlanner: 30000, // 30 seconds
  structuralCheck: 500, // 500ms
  compiler: 500, // 500ms
  compiledWorkflowCheck: 500, // 500ms
  contractCheck: 200, // 200ms
  sandbox: 60000, // 60 seconds (configurable per workflow)
  repairAgent: 30000, // 30 seconds
};

// ============================================================================
// Error Recovery Strategies
// ============================================================================

/**
 * Retry configuration for error recovery
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Default retry configurations by failure classification
 */
export const DEFAULT_RETRY_CONFIGS: Record<FailureClassification, RetryConfig> = {
  [FailureClassification.LOGIC_FAILURE]: {
    maxAttempts: 3, // Repair Agent attempts
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  [FailureClassification.INFRASTRUCTURE_FAILURE]: {
    maxAttempts: 3,
    initialDelayMs: 1000, // 1 second
    maxDelayMs: 8000, // 8 seconds
    backoffMultiplier: 2, // Exponential backoff
  },
  [FailureClassification.EXTERNAL_SOURCE_FAILURE]: {
    maxAttempts: 0, // No automatic retry, handle per reason
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
};

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
  attemptNumber: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE]
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Check if an error should be retried based on classification
 */
export function shouldRetry(
  classification: FailureClassification,
  attemptNumber: number,
  config?: RetryConfig
): boolean {
  const retryConfig = config || DEFAULT_RETRY_CONFIGS[classification];
  return attemptNumber < retryConfig.maxAttempts;
}

/**
 * Error recovery strategy interface
 */
export interface ErrorRecoveryStrategy {
  classification: FailureClassification;
  action: 'retry' | 'repair' | 'degrade' | 'escalate';
  retryConfig?: RetryConfig;
  escalateAfterAttempts?: number;
}

/**
 * Get appropriate recovery strategy for a failure classification
 */
export function getRecoveryStrategy(classification: FailureClassification): ErrorRecoveryStrategy {
  switch (classification) {
    case FailureClassification.LOGIC_FAILURE:
      return {
        classification,
        action: 'repair',
        retryConfig: DEFAULT_RETRY_CONFIGS[classification],
        escalateAfterAttempts: 3,
      };
    case FailureClassification.INFRASTRUCTURE_FAILURE:
      return {
        classification,
        action: 'retry',
        retryConfig: DEFAULT_RETRY_CONFIGS[classification],
        escalateAfterAttempts: 3,
      };
    case FailureClassification.EXTERNAL_SOURCE_FAILURE:
      return {
        classification,
        action: 'degrade',
        retryConfig: DEFAULT_RETRY_CONFIGS[classification],
      };
  }
}

// ============================================================================
// Base Error Class
// ============================================================================

export class PlatformError extends Error {
  readonly errorId: string;
  readonly context: Record<string, any>;
  readonly retryable: boolean;

  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message);
    this.name = this.constructor.name;
    this.errorId = PlatformError.generateErrorId();
    this.context = context;
    this.retryable = retryable;
    // Maintain proper stack trace for where our error was thrown (only available on V8)
    const errorConstructor = Error as unknown as {
      captureStackTrace?: (target: object, constructor: unknown) => void;
    };
    if (typeof errorConstructor.captureStackTrace === 'function') {
      errorConstructor.captureStackTrace(this, this.constructor);
    }
  }

  private static generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  toString(): string {
    return `${this.name}[${this.errorId}]: ${this.message}`;
  }
}

// ============================================================================
// Planning Errors
// ============================================================================

export class PlanningError extends PlatformError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'PlanningError';
  }
}

export class PromptParsingError extends PlanningError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'PromptParsingError';
  }
}

export class PromptTooLongError extends PromptParsingError {
  constructor(promptLength: number, maxLength: number = 10000) {
    super(
      `Prompt exceeds maximum length of ${maxLength} characters`,
      { prompt_length: promptLength, max_length: maxLength },
      false
    );
    this.name = 'PromptTooLongError';
  }
}

export class PromptEmptyError extends PromptParsingError {
  constructor() {
    super('Prompt cannot be empty', { prompt_length: 0 }, false);
    this.name = 'PromptEmptyError';
  }
}

export class AmbiguousPromptError extends PromptParsingError {
  constructor(ambiguities: string[]) {
    super('Prompt contains ambiguous elements requiring clarification', { ambiguities }, false);
    this.name = 'AmbiguousPromptError';
  }
}

export class CapabilityNotInVocabularyError extends PlanningError {
  constructor(capability: string, availableCapabilities: string[]) {
    super(
      `Capability '${capability}' is not in the vocabulary`,
      { capability, availableCapabilities },
      false
    );
    this.name = 'CapabilityNotInVocabularyError';
  }
}

export class IrGenerationError extends PlanningError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false);
    this.name = 'IrGenerationError';
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

export class ValidationError extends PlatformError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'ValidationError';
  }
}

export class StructuralValidationError extends ValidationError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'StructuralValidationError';
  }
}

export class InvalidStepTypeError extends StructuralValidationError {
  constructor(stepId: string, invalidType: string, availableTypes: string[]) {
    super(
      `Step '${stepId}' has invalid type '${invalidType}'`,
      { step_id: stepId, invalid_type: invalidType, available_types: availableTypes },
      false
    );
    this.name = 'InvalidStepTypeError';
  }
}

export class MissingParameterError extends StructuralValidationError {
  constructor(stepId: string, parameterName: string, requiredBy: string) {
    super(
      `Step '${stepId}' is missing required parameter '${parameterName}'`,
      { step_id: stepId, parameter: parameterName, required_by: requiredBy },
      false
    );
    this.name = 'MissingParameterError';
  }
}

export class UndefinedFieldReferenceError extends StructuralValidationError {
  constructor(stepId: string, field: string, sourceStep: string) {
    super(
      `Field '${field}' referenced in step '${stepId}' is undefined`,
      { step_id: stepId, field, source_step: sourceStep },
      false
    );
    this.name = 'UndefinedFieldReferenceError';
  }
}

export class CompilationError extends ValidationError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'CompilationError';
  }
}

export class TemplateNotFoundError extends CompilationError {
  constructor(templateId: string, availableTemplates: string[]) {
    super(
      `Template '${templateId}' not found`,
      { template_id: templateId, available_templates: availableTemplates },
      false
    );
    this.name = 'TemplateNotFoundError';
  }
}

export class NodeAssemblyError extends CompilationError {
  constructor(nodeId: string, error: string) {
    super(`Failed to assemble node '${nodeId}'`, { node_id: nodeId, error }, false);
    this.name = 'NodeAssemblyError';
  }
}

export class ContractViolationError extends ValidationError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false);
    this.name = 'ContractViolationError';
  }
}

export class MissingFieldError extends ContractViolationError {
  constructor(field: string, requiredBy: string) {
    super(`Required field '${field}' is missing`, { field, required_by: requiredBy });
    this.name = 'MissingFieldError';
  }
}

export class SandboxExecutionError extends ValidationError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false);
    this.name = 'SandboxExecutionError';
  }
}

// ============================================================================
// Execution Errors
// ============================================================================

export class ExecutionError extends PlatformError {
  readonly classification?: FailureClassification;

  constructor(
    message: string,
    context: Record<string, any> = {},
    retryable = false,
    classification?: FailureClassification
  ) {
    super(message, context, retryable);
    this.name = 'ExecutionError';
    this.classification = classification;
  }
}

export class LogicFailureError extends ExecutionError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false, FailureClassification.LOGIC_FAILURE);
    this.name = 'LogicFailureError';
  }
}

export class InfrastructureFailureError extends ExecutionError {
  constructor(message: string, context: Record<string, any> = {}, retryable = true) {
    super(message, context, retryable, FailureClassification.INFRASTRUCTURE_FAILURE);
    this.name = 'InfrastructureFailureError';
  }
}

export class ExternalSourceUnavailableError extends ExecutionError {
  readonly reason?: ExternalSourceFailureReason;

  constructor(
    message: string,
    context: Record<string, any> = {},
    reason: ExternalSourceFailureReason = ExternalSourceFailureReason.UNKNOWN
  ) {
    super(message, context, false, FailureClassification.EXTERNAL_SOURCE_FAILURE);
    this.name = 'ExternalSourceFailureError';
    this.reason = reason;
  }
}

// ============================================================================
// Deployment Errors
// ============================================================================

export class DeploymentError extends PlatformError {
  constructor(message: string, context: Record<string, any> = {}, retryable = false) {
    super(message, context, retryable);
    this.name = 'DeploymentError';
  }
}

export class CredentialMissingError extends DeploymentError {
  constructor(credentials: string[]) {
    super(
      `Missing required credentials: ${credentials.join(', ')}`,
      { missing_credentials: credentials },
      false
    );
    this.name = 'CredentialMissingError';
  }
}

export class DeploymentFailedError extends DeploymentError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false);
    this.name = 'DeploymentFailedError';
  }
}

export class ActivationFailedError extends DeploymentError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context, false);
    this.name = 'ActivationFailedError';
  }
}

// ============================================================================
// Error Response Interface
// ============================================================================

export interface ErrorResponse {
  errorId: string;
  type: string;
  message: string;
  context: Record<string, any>;
  retryable: boolean;
  timestamp: string;
  stackTrace?: string;
}

// ============================================================================
// Error Formatting Utilities
// ============================================================================

export function formatError(error: PlatformError | Error): ErrorResponse {
  const platformError = error instanceof PlatformError ? error : new PlatformError(error.message);

  return {
    errorId: platformError.errorId,
    type: platformError.name,
    message: platformError.message,
    context: platformError.context,
    retryable: platformError.retryable,
    timestamp: new Date().toISOString(),
    stackTrace: error.stack,
  };
}

export function formatErrorForLogging(error: PlatformError | Error): Record<string, any> {
  const formatted = formatError(error);

  return {
    ...formatted,
    context: JSON.stringify(formatted.context),
  };
}

export function formatErrorForResponse(error: PlatformError | Error): Record<string, any> {
  const formatted = formatError(error);

  // Remove sensitive context data if present
  const safeContext = { ...formatted.context };
  const sensitiveKeys = ['password', 'secret', 'token', 'credential'];

  for (const key of sensitiveKeys) {
    if (key in safeContext) {
      safeContext[key] = '[REDAACTED]';
    }
  }

  return {
    error: {
      id: formatted.errorId,
      type: formatted.type,
      message: formatted.message,
      context: safeContext,
      retryable: formatted.retryable,
    },
    timestamp: formatted.timestamp,
  };
}

export function isErrorRetryable(error: PlatformError | Error): boolean {
  return error instanceof PlatformError ? error.retryable : false;
}

export function classifyErrorByType(error: PlatformError | Error): string {
  if (error instanceof PlatformError) {
    return error.name;
  }
  return 'UnknownError';
}
