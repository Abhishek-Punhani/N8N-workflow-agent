/**
 * AI Data Intelligence Platform - Failure Classification
 * Enum and classifier for handling different failure types with appropriate strategies
 */

// ============================================================================
// Failure Classification Enum
// ============================================================================

export enum FailureClassification {
  LOGIC_FAILURE = 'LOGIC_FAILURE',
  INFRASTRUCTURE_FAILURE = 'INFRASTRUCTURE_FAILURE',
  EXTERNAL_SOURCE_UNAVAILABLE = 'EXTERNAL_SOURCE_UNAVAILABLE',
}

// ============================================================================
// Failure Classification Metadata
// ============================================================================

export interface FailureClassificationMetadata {
  classification: FailureClassification;
  description: string;
  shouldRetry: boolean;
  maxRetries: number;
  backoffStrategy: 'none' | 'linear' | 'exponential';
  responseAction: 'repair' | 'retry' | 'degraded_mode' | 'block';
  escalatesTo: 'repair_agent' | 'ops_alert' | 'degraded_mode' | 'manual';
  affectedComponents: string[];
}

export const FAILURE_CLASSIFICATION_METADATA: Record<
  FailureClassification,
  FailureClassificationMetadata
> = {
  [FailureClassification.LOGIC_FAILURE]: {
    classification: FailureClassification.LOGIC_FAILURE,
    description: 'Failure due to incorrect workflow logic or configuration',
    shouldRetry: false,
    maxRetries: 0,
    backoffStrategy: 'none',
    responseAction: 'repair',
    escalatesTo: 'repair_agent',
    affectedComponents: ['IR', 'workflow_planner', 'compiler'],
  },
  [FailureClassification.INFRASTRUCTURE_FAILURE]: {
    classification: FailureClassification.INFRASTRUCTURE_FAILURE,
    description: 'Failure due to infrastructure issues (network, service unavailable)',
    shouldRetry: true,
    maxRetries: 3,
    backoffStrategy: 'exponential',
    responseAction: 'retry',
    escalatesTo: 'ops_alert',
    affectedComponents: ['network', 'external_services', 'compute_resources'],
  },
  [FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE]: {
    classification: FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE,
    description: 'Failure due to external data source being unavailable',
    shouldRetry: false,
    maxRetries: 0,
    backoffStrategy: 'none',
    responseAction: 'degraded_mode',
    escalatesTo: 'degraded_mode',
    affectedComponents: ['external_sources', 'data_sources'],
  },
};

// ============================================================================
// Failure Classifier
// ============================================================================

export interface FailureContext {
  errorMessage: string;
  stepId?: string;
  sourceType?: string;
  httpStatus?: number;
  errorType?: string;
  stackTrace?: string;
  timestamp: string;
  retryCount: number;
}

export class FailureClassifier {
  /**
   * Classify a failure based on its context and patterns
   * @param failureContext Context information about the failure
   * @returns The failure classification
   */
  public classify(failureContext: FailureContext): FailureClassification {
    const { errorMessage, sourceType, httpStatus, errorType } = failureContext;

    // Check for external source patterns
    if (this.isExternalSourceUnavailable(errorMessage, sourceType, httpStatus)) {
      return FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE;
    }

    // Check for infrastructure patterns
    if (this.isInfrastructureFailure(errorMessage, httpStatus, errorType)) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }

    // Default to logic failure if no other pattern matches
    return FailureClassification.LOGIC_FAILURE;
  }

  /**
   * Get metadata for a failure classification
   * @param classification The failure classification
   * @returns The metadata for that classification
   */
  public getMetadata(classification: FailureClassification): FailureClassificationMetadata {
    return FAILURE_CLASSIFICATION_METADATA[classification];
  }

  /**
   * Check if a failure indicates an external source is unavailable
   */
  private isExternalSourceUnavailable(
    errorMessage: string,
    _sourceType?: string,
    httpStatus?: number
  ): boolean {
    // Check HTTP status codes
    if (httpStatus !== undefined) {
      if (httpStatus === 404 || httpStatus === 410) {
        return true;
      }
      if (httpStatus >= 503 && httpStatus < 506) {
        return true;
      }
    }

    // Check for common external source error patterns
    const externalErrorPatterns = [
      'external source',
      'data source unavailable',
      'connection refused',
      'connection timeout',
      'network unreachable',
      'host unreachable',
      'dns lookup failed',
      'service unavailable',
      'gateway timeout',
      'upstream server unavailable',
      'source not found',
      'resource not available',
    ];

    const lowerErrorMessage = errorMessage.toLowerCase();
    return externalErrorPatterns.some(pattern => lowerErrorMessage.includes(pattern));
  }

  /**
   * Check if a failure indicates an infrastructure issue
   */
  private isInfrastructureFailure(
    errorMessage: string,
    httpStatus?: number,
    _errorType?: string
  ): boolean {
    // Check HTTP status codes
    if (httpStatus !== undefined) {
      if (httpStatus >= 500 && httpStatus < 503) {
        return true;
      }
    }

    // Check for common infrastructure error patterns
    const infrastructureErrorPatterns = [
      'memory limit',
      'cpu limit',
      'timeout exceeded',
      'out of memory',
      'disk full',
      'resource exhausted',
      'rate limit',
      'throttled',
      'service unavailable',
      'internal server error',
      'bad gateway',
      'connection reset',
      'socket error',
    ];

    const lowerErrorMessage = errorMessage.toLowerCase();
    return infrastructureErrorPatterns.some(pattern => lowerErrorMessage.includes(pattern));
  }

  /**
   * Get the recommended response action for a failure
   */
  public getResponseAction(
    failureContext: FailureContext
  ): 'repair' | 'retry' | 'degraded_mode' | 'block' {
    const classification = this.classify(failureContext);
    return FAILURE_CLASSIFICATION_METADATA[classification].responseAction;
  }

  /**
   * Get the escalation target for a failure
   */
  public getEscalationTarget(
    failureContext: FailureContext
  ): 'repair_agent' | 'ops_alert' | 'degraded_mode' | 'manual' {
    const classification = this.classify(failureContext);
    return FAILURE_CLASSIFICATION_METADATA[classification].escalatesTo;
  }

  /**
   * Check if a failure should be retried
   */
  public shouldRetry(failureContext: FailureContext): boolean {
    const classification = this.classify(failureContext);
    return FAILURE_CLASSIFICATION_METADATA[classification].shouldRetry;
  }

  /**
   * Get the maximum retry count for a failure
   */
  public getMaxRetries(failureContext: FailureContext): number {
    const classification = this.classify(failureContext);
    return FAILURE_CLASSIFICATION_METADATA[classification].maxRetries;
  }

  /**
   * Calculate the backoff delay for a retry
   */
  public calculateBackoffDelay(failureContext: FailureContext, attemptNumber: number): number {
    const classification = this.classify(failureContext);
    const metadata = FAILURE_CLASSIFICATION_METADATA[classification];

    if (metadata.backoffStrategy === 'none') {
      return 0;
    }

    const baseDelay = 1000; // 1 second base delay

    if (metadata.backoffStrategy === 'linear') {
      return baseDelay * attemptNumber;
    }

    if (metadata.backoffStrategy === 'exponential') {
      const delay = baseDelay * Math.pow(2, attemptNumber - 1);
      return Math.min(delay, 30000);
    }

    return 0;
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

export function createFailureClassificationFromError(
  error: Error,
  context: Record<string, any> = {}
): { classification: FailureClassification; metadata: FailureClassificationMetadata } {
  const classifier = new FailureClassifier();
  const failureContext: FailureContext = {
    errorMessage: error.message,
    timestamp: new Date().toISOString(),
    retryCount: 0,
    ...context,
  };

  const classification = classifier.classify(failureContext);
  const metadata = classifier.getMetadata(classification);

  return { classification, metadata };
}

export function getErrorResponseForClassification(
  classification: FailureClassification,
  message: string,
  context: Record<string, any> = {}
): {
  errorId: string;
  type: FailureClassification;
  message: string;
  context: Record<string, any>;
  retryable: boolean;
  timestamp: string;
} {
  const metadata = FAILURE_CLASSIFICATION_METADATA[classification];

  return {
    errorId: `err_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    type: classification,
    message: `${message} (${metadata.description})`,
    context: {
      ...context,
      classification,
      shouldRetry: metadata.shouldRetry,
      maxRetries: metadata.maxRetries,
      responseAction: metadata.responseAction,
    },
    retryable: metadata.shouldRetry,
    timestamp: new Date().toISOString(),
  };
}
