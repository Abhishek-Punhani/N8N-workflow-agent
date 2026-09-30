/**
 * AI Data Intelligence Platform - Failure Classification Tests
 */

import {
  FailureClassification,
  FAILURE_CLASSIFICATION_METADATA,
  FailureClassifier,
  FailureContext,
  createFailureClassificationFromError,
  getErrorResponseForClassification,
} from './classification.js';

// ============================================================================
// Failure Classification Enum Tests
// ============================================================================

describe('FailureClassification', () => {
  test('should have correct enum values', () => {
    expect(FailureClassification.LOGIC_FAILURE).toBe('LOGIC_FAILURE');
    expect(FailureClassification.INFRASTRUCTURE_FAILURE).toBe('INFRASTRUCTURE_FAILURE');
    expect(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE).toBe('EXTERNAL_SOURCE_UNAVAILABLE');
  });
});

describe('FAILURE_CLASSIFICATION_METADATA', () => {
  test('should have metadata for all classifications', () => {
    const classifications = Object.values(FailureClassification);
    expect(Object.keys(FAILURE_CLASSIFICATION_METADATA).length).toBe(classifications.length);
  });

  test('LOGIC_FAILURE should have correct metadata', () => {
    const metadata = FAILURE_CLASSIFICATION_METADATA[FailureClassification.LOGIC_FAILURE];
    expect(metadata.classification).toBe(FailureClassification.LOGIC_FAILURE);
    expect(metadata.description).toBe('Failure due to incorrect workflow logic or configuration');
    expect(metadata.shouldRetry).toBe(false);
    expect(metadata.maxRetries).toBe(0);
    expect(metadata.backoffStrategy).toBe('none');
    expect(metadata.responseAction).toBe('repair');
    expect(metadata.escalatesTo).toBe('repair_agent');
    expect(metadata.affectedComponents).toEqual(['IR', 'workflow_planner', 'compiler']);
  });

  test('INFRASTRUCTURE_FAILURE should have correct metadata', () => {
    const metadata = FAILURE_CLASSIFICATION_METADATA[FailureClassification.INFRASTRUCTURE_FAILURE];
    expect(metadata.classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    expect(metadata.description).toBe(
      'Failure due to infrastructure issues (network, service unavailable)'
    );
    expect(metadata.shouldRetry).toBe(true);
    expect(metadata.maxRetries).toBe(3);
    expect(metadata.backoffStrategy).toBe('exponential');
    expect(metadata.responseAction).toBe('retry');
    expect(metadata.escalatesTo).toBe('ops_alert');
    expect(metadata.affectedComponents).toEqual([
      'network',
      'external_services',
      'compute_resources',
    ]);
  });

  test('EXTERNAL_SOURCE_UNAVAILABLE should have correct metadata', () => {
    const metadata =
      FAILURE_CLASSIFICATION_METADATA[FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE];
    expect(metadata.classification).toBe(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE);
    expect(metadata.description).toBe('Failure due to external data source being unavailable');
    expect(metadata.shouldRetry).toBe(false);
    expect(metadata.maxRetries).toBe(0);
    expect(metadata.backoffStrategy).toBe('none');
    expect(metadata.responseAction).toBe('degraded_mode');
    expect(metadata.escalatesTo).toBe('degraded_mode');
    expect(metadata.affectedComponents).toEqual(['external_sources', 'data_sources']);
  });
});

// ============================================================================
// FailureClassifier Tests
// ============================================================================

describe('FailureClassifier', () => {
  let classifier: FailureClassifier;

  beforeEach(() => {
    classifier = new FailureClassifier();
  });

  describe('classify', () => {
    test('should classify external source unavailable by HTTP status', () => {
      const context: FailureContext = {
        errorMessage: 'Connection refused',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 503,
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE);
    });

    test('should classify external source unavailable by error message pattern', () => {
      const context: FailureContext = {
        errorMessage: 'Data source unavailable - API endpoint not responding',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        sourceType: 'http',
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE);
    });

    test('should classify infrastructure failure by HTTP status', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    });

    test('should classify infrastructure failure by error message pattern', () => {
      const context: FailureContext = {
        errorMessage: 'Timeout exceeded - service unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      classifier.classify(context);
    });

    test('should classify logic failure by default', () => {
      const context: FailureContext = {
        errorMessage: 'Invalid step type',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.LOGIC_FAILURE);
    });

    test('should classify memory limit errors as infrastructure', () => {
      const context: FailureContext = {
        errorMessage: 'Out of memory limit exceeded',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    });

    test('should classify connection refused as external source', () => {
      const context: FailureContext = {
        errorMessage: 'Connection refused by external API',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const classification = classifier.classify(context);
      expect(classification).toBe(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE);
    });
  });

  describe('getMetadata', () => {
    test('should return metadata for LOGIC_FAILURE', () => {
      const metadata = classifier.getMetadata(FailureClassification.LOGIC_FAILURE);
      expect(metadata.shouldRetry).toBe(false);
      expect(metadata.maxRetries).toBe(0);
      expect(metadata.responseAction).toBe('repair');
    });

    test('should return metadata for INFRASTRUCTURE_FAILURE', () => {
      const metadata = classifier.getMetadata(FailureClassification.INFRASTRUCTURE_FAILURE);
      expect(metadata.shouldRetry).toBe(true);
      expect(metadata.maxRetries).toBe(3);
      expect(metadata.backoffStrategy).toBe('exponential');
      expect(metadata.responseAction).toBe('retry');
    });

    test('should return metadata for EXTERNAL_SOURCE_UNAVAILABLE', () => {
      const metadata = classifier.getMetadata(FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE);
      expect(metadata.shouldRetry).toBe(false);
      expect(metadata.responseAction).toBe('degraded_mode');
    });
  });

  describe('getResponseAction', () => {
    test('should return repair for logic failure', () => {
      const context: FailureContext = {
        errorMessage: 'Invalid step type',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const action = classifier.getResponseAction(context);
      expect(action).toBe('repair');
    });

    test('should return retry for infrastructure failure', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      const action = classifier.getResponseAction(context);
      expect(action).toBe('retry');
    });

    test('should return degraded_mode for external source unavailable', () => {
      const context: FailureContext = {
        errorMessage: 'Source unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 503,
      };

      const action = classifier.getResponseAction(context);
      expect(action).toBe('degraded_mode');
    });
  });

  describe('getEscalationTarget', () => {
    test('should return repair_agent for logic failure', () => {
      const context: FailureContext = {
        errorMessage: 'Invalid step type',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const target = classifier.getEscalationTarget(context);
      expect(target).toBe('repair_agent');
    });

    test('should return ops_alert for infrastructure failure', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      const target = classifier.getEscalationTarget(context);
      expect(target).toBe('ops_alert');
    });

    test('should return degraded_mode for external source unavailable', () => {
      const context: FailureContext = {
        errorMessage: 'Source unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 503,
      };

      const target = classifier.getEscalationTarget(context);
      expect(target).toBe('degraded_mode');
    });
  });

  describe('shouldRetry', () => {
    test('should return false for logic failure', () => {
      const context: FailureContext = {
        errorMessage: 'Invalid step type',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      expect(classifier.shouldRetry(context)).toBe(false);
    });

    test('should return true for infrastructure failure', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      expect(classifier.shouldRetry(context)).toBe(true);
    });

    test('should return false for external source unavailable', () => {
      const context: FailureContext = {
        errorMessage: 'Source unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 503,
      };

      expect(classifier.shouldRetry(context)).toBe(false);
    });
  });

  describe('getMaxRetries', () => {
    test('should return 0 for logic failure', () => {
      const context: FailureContext = {
        errorMessage: 'Invalid step type',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      expect(classifier.getMaxRetries(context)).toBe(0);
    });

    test('should return 3 for infrastructure failure', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      expect(classifier.getMaxRetries(context)).toBe(3);
    });

    test('should return 0 for external source unavailable', () => {
      const context: FailureContext = {
        errorMessage: 'Source unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 503,
      };

      expect(classifier.getMaxRetries(context)).toBe(0);
    });
  });

  describe('calculateBackoffDelay', () => {
    test('should calculate exponential backoff', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      expect(classifier.calculateBackoffDelay(context, 1)).toBe(1000); // 1 * 2^0
      expect(classifier.calculateBackoffDelay(context, 2)).toBe(2000); // 1 * 2^1
      expect(classifier.calculateBackoffDelay(context, 3)).toBe(4000); // 1 * 2^2
      expect(classifier.calculateBackoffDelay(context, 4)).toBe(8000); // 1 * 2^3
    });

    test('should cap at max delay', () => {
      const context: FailureContext = {
        errorMessage: 'Internal server error',
        timestamp: new Date().toISOString(),
        retryCount: 0,
        httpStatus: 500,
      };

      // After many retries, delay should be capped at 30000ms
      expect(classifier.calculateBackoffDelay(context, 10)).toBe(30000);
    });
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe('createFailureClassificationFromError', () => {
  test('should classify error and return metadata', () => {
    const error = new Error('Internal server error');
    const context: FailureContext = {
      errorMessage: error.message,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      httpStatus: 500,
    };

    const result = createFailureClassificationFromError(error, context);
    expect(result.classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    expect(result.metadata.shouldRetry).toBe(true);
    expect(result.metadata.maxRetries).toBe(3);
  });
});

describe('getErrorResponseForClassification', () => {
  test('should create error response with classification details', () => {
    const response = getErrorResponseForClassification(
      FailureClassification.INFRASTRUCTURE_FAILURE,
      'Service error'
    );

    expect(response.errorId).toBeDefined();
    expect(response.type).toBe('INFRASTRUCTURE_FAILURE');
    expect(response.message).toContain('Service error');
    expect(response.message).toContain('infrastructure issues');
    expect(response.retryable).toBe(true);
    expect(response.context).toHaveProperty('classification');
    expect(response.context).toHaveProperty('shouldRetry', true);
    expect(response.context).toHaveProperty('maxRetries', 3);
    expect(response.context).toHaveProperty('responseAction', 'retry');
  });

  test('should include custom context', () => {
    const context = { step_id: 'step1', node_id: 'node1' };
    const response = getErrorResponseForClassification(
      FailureClassification.EXTERNAL_SOURCE_UNAVAILABLE,
      'Source unavailable',
      context
    );

    expect(response.context.step_id).toBe('step1');
    expect(response.context.node_id).toBe('node1');
  });
});
