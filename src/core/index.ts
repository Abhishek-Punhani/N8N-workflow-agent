/**
 * AI Data Intelligence Platform - Core Module
 * Exports all core type definitions and schemas
 */

// Export all types from types.ts
export type * from './types.js';
export { CAPABILITY_VOCABULARY } from './types.js';

// Export all schemas
export * from './schemas.js';

// Export all errors
export * from './errors.js';

// Export all capabilities utilities
export * from './capabilities.js';

// Export configuration (avoid duplicates by exporting specific items)
export {
  Config,
  DEFAULT_TIMEOUTS,
  DEFAULT_RECOVERY_STRATEGIES,
  DEFAULT_ERROR_THRESHOLDS,
} from './config.js';
export {
  getTimeoutForComponent,
  validateTimeout,
  formatTimeout,
  createTimeoutHandler,
  calculateBackoffDelay,
  shouldRetryAttempt,
} from './config.js';

// Export classification utilities (avoid FailureClassification duplicate)
export {
  FailureClassificationMetadata,
  FAILURE_CLASSIFICATION_METADATA,
  FailureContext,
  FailureClassifier,
  createFailureClassificationFromError,
  getErrorResponseForClassification,
} from './classification.js';

// Export template registry
export * from './template-registry.js';
