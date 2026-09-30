/**
 * AI Data Intelligence Platform - Failure Classifier
 *
 * Classifies runtime execution failures into the three platform categories
 * and builds a complete FailureTrace for downstream repair/retry/degrade logic.
 *
 * Classification rules (Requirements 7.3, 7.4, 7.5, 7.6, 13.1):
 *
 *  EXTERNAL_SOURCE_FAILURE  (checked first — highest signal specificity)
 *    • HTTP 404 / 410  — resource gone, source not found
 *    • HTTP 429        — rate limited
 *    • HTTP 503        — service unavailable / source down
 *    • DNS / ENOTFOUND — host unreachable
 *    • Connection refused to external source
 *    • "source unavailable", "external source", "gateway timeout" messages
 *    • ExternalSourceUnavailableError instances
 *
 *  INFRASTRUCTURE_FAILURE  (checked second)
 *    • HTTP 500–502, 504  — server errors
 *    • Network-level errors: ECONNRESET, socket, network
 *    • Timeout errors (including SandboxTimeoutError)
 *    • Out of memory / resource exhaustion
 *    • InfrastructureFailureError instances
 *
 *  LOGIC_FAILURE  (default — incorrect workflow logic)
 *    • Anything that doesn't match the above
 *    • LogicFailureError, ValidationError instances
 *    • Type errors, assertion errors, malformed data
 *
 * Requirements: 7.3, 7.4, 7.5, 7.6, 13.1
 */

import {
  FailureClassification,
  InfrastructureFailureError,
  ExternalSourceUnavailableError,
  LogicFailureError,
  ExecutionError,
  getRecoveryStrategy,
} from '../core/errors.js';
import type { FailureTrace } from '../core/types.js';
import type { FailureClassifierInput, FailureClassificationResult } from './types.js';
import { SandboxTimeoutError } from './sandbox.js';

// ============================================================================
// Classification rule sets
// ============================================================================

/** HTTP status codes that indicate an external source is unavailable. */
const EXTERNAL_SOURCE_HTTP_CODES = new Set([404, 410, 429, 503, 522, 523, 524]);

/** HTTP status codes that indicate an infrastructure failure. */
const INFRASTRUCTURE_HTTP_CODES = new Set([500, 501, 502, 504, 507, 508]);

/** Message patterns that indicate an external source problem. */
const EXTERNAL_SOURCE_PATTERNS = [
  'enotfound',
  'dns',
  'connection refused',
  'external source',
  'source unavailable',
  'source not found',
  'resource not available',
  'gateway timeout',
  'service unavailable',
  '404',
  '410',
  '429',
  '503',
  'rate limit',
  'rate-limit',
  'too many requests',
  'robots.txt',
  'captcha',
  'bot blocked',
  'access denied by source',
  'forbidden by source',
] as const;

/** Message patterns that indicate an infrastructure failure. */
const INFRASTRUCTURE_PATTERNS = [
  'timeout',
  'timed out',
  'network',
  'econnreset',
  'econnrefused',
  'socket',
  'internal server error',
  '500',
  '502',
  '504',
  'bad gateway',
  'out of memory',
  'memory limit',
  'cpu limit',
  'resource exhausted',
  'disk full',
  'heap',
  'sigkill',
  'oom',
] as const;

// ============================================================================
// FailureClassifier class
// ============================================================================

/**
 * Classifies runtime errors into FailureClassification categories and
 * produces a complete FailureTrace with all fields required by the spec.
 *
 * Requirements: 7.3, 7.4, 7.5, 7.6, 13.1
 */
export class FailureClassifier {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Classify a runtime error and produce a FailureClassificationResult
   * containing both the classification and the full FailureTrace.
   *
   * @param input  FailureClassifierInput — error, step_id, retry_count.
   * @returns      FailureClassificationResult with classification, trace,
   *               and recommended_action.
   */
  public classify(input: FailureClassifierInput): FailureClassificationResult {
    const { error, step_id, retry_count } = input;

    const classification = this.classifyError(error);
    const trace = this.buildTrace(error, step_id, classification, retry_count);
    const strategy = getRecoveryStrategy(classification);

    return {
      classification,
      trace,
      recommended_action: this.toRecommendedAction(strategy.action),
    };
  }

  /**
   * Classify an error without building a full trace.
   * Useful when only the classification enum value is needed.
   */
  public classifyError(error: Error): FailureClassification {
    // ---- 1. Typed error instances (most specific — check first) ------------

    if (error instanceof ExternalSourceUnavailableError) {
      return FailureClassification.EXTERNAL_SOURCE_FAILURE;
    }

    if (error instanceof SandboxTimeoutError) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }

    if (error instanceof InfrastructureFailureError) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }

    if (error instanceof LogicFailureError) {
      return FailureClassification.LOGIC_FAILURE;
    }

    // ExecutionError with explicit classification
    if (error instanceof ExecutionError && error.classification !== undefined) {
      return error.classification;
    }

    // ---- 2. HTTP status code embedded in message ---------------------------

    const httpStatus = this.extractHttpStatus(error.message);
    if (httpStatus !== null) {
      if (EXTERNAL_SOURCE_HTTP_CODES.has(httpStatus)) {
        return FailureClassification.EXTERNAL_SOURCE_FAILURE;
      }
      if (INFRASTRUCTURE_HTTP_CODES.has(httpStatus)) {
        return FailureClassification.INFRASTRUCTURE_FAILURE;
      }
    }

    // ---- 3. Message pattern matching ---------------------------------------

    const lower = error.message.toLowerCase();

    if (EXTERNAL_SOURCE_PATTERNS.some(p => lower.includes(p))) {
      return FailureClassification.EXTERNAL_SOURCE_FAILURE;
    }

    if (INFRASTRUCTURE_PATTERNS.some(p => lower.includes(p))) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }

    // ---- 4. Error name heuristics ------------------------------------------

    const name = error.name.toLowerCase();
    if (name.includes('timeout') || name.includes('abort')) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }
    if (name.includes('network') || name.includes('connection')) {
      return FailureClassification.INFRASTRUCTURE_FAILURE;
    }

    // ---- 5. Default: logic failure -----------------------------------------
    return FailureClassification.LOGIC_FAILURE;
  }

  // -------------------------------------------------------------------------
  // Private: trace builder
  // -------------------------------------------------------------------------

  /**
   * Build a complete FailureTrace from an error and context.
   * Captures step_id, error_message, stack_trace, timestamp,
   * classification, and retry_count (Requirement 7.6, 13.1).
   */
  private buildTrace(
    error: Error,
    step_id: string,
    classification: FailureClassification,
    retry_count: number
  ): FailureTrace {
    return {
      step_id,
      error_message: error.message,
      stack_trace: error.stack,
      timestamp: new Date().toISOString(),
      classification,
      retry_count,
    };
  }

  // -------------------------------------------------------------------------
  // Private: helpers
  // -------------------------------------------------------------------------

  /**
   * Attempt to extract an HTTP status code from an error message.
   * Looks for patterns like "HTTP 503", "status: 404", "returned 502", etc.
   * Returns null if no status code found.
   */
  private extractHttpStatus(message: string): number | null {
    // Match common patterns: "HTTP 503", "status 404", "code: 500", bare 3-digit codes
    const patterns = [
      /\bhttp\s+(\d{3})\b/i,
      /\bstatus[:\s]+(\d{3})\b/i,
      /\bcode[:\s]+(\d{3})\b/i,
      /\breturned\s+(\d{3})\b/i,
      /\b(4\d{2}|5\d{2})\b/,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const code = parseInt(match[1], 10);
        if (code >= 400 && code < 600) return code;
      }
    }

    return null;
  }

  /**
   * Map recovery strategy action to the recommended_action enum in
   * FailureClassificationResult.
   */
  private toRecommendedAction(
    action: 'retry' | 'repair' | 'degrade' | 'escalate'
  ): FailureClassificationResult['recommended_action'] {
    // Map core strategy 'degrade' → run-module 'degraded'
    if (action === 'degrade') return 'degraded';
    return action;
  }
}
