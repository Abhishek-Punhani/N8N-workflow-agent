/**
 * AI Data Intelligence Platform - Retry Handler
 *
 * Executes an async operation with exponential backoff retries for
 * INFRASTRUCTURE_FAILURE scenarios. Up to 3 total attempts (1 initial +
 * 2 retries), with delays: 1s → 2s → 4s (capped at maxDelayMs).
 *
 * Requirements: 7.5, 13.3
 */

import {
  FailureClassification,
  DEFAULT_RETRY_CONFIGS,
  calculateRetryDelay,
} from '../core/errors.js';
import type { RetryConfig, RetryResult } from './types.js';

// ============================================================================
// RetryHandler class
// ============================================================================

/**
 * RetryHandler wraps any async operation with configurable exponential
 * backoff retry logic.
 *
 * Only INFRASTRUCTURE_FAILURE results trigger a retry. LOGIC_FAILURE and
 * EXTERNAL_SOURCE_FAILURE return immediately (no retry).
 *
 * Requirements: 7.5, 13.3
 */
export class RetryHandler {
  private readonly config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    // Default: map INFRASTRUCTURE_FAILURE core config to run/types RetryConfig shape.
    // max_retries = number of *retry* attempts (not including initial attempt).
    const coreConfig = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE];
    this.config = {
      max_retries: config?.max_retries ?? coreConfig.maxAttempts - 1, // maxAttempts=3 → 2 retries
      base_delay_ms: config?.base_delay_ms ?? coreConfig.initialDelayMs,
      max_delay_ms: config?.max_delay_ms ?? coreConfig.maxDelayMs,
      backoff_multiplier: config?.backoff_multiplier ?? coreConfig.backoffMultiplier,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute an operation, retrying on INFRASTRUCTURE_FAILURE with exponential
   * backoff up to max_retries additional attempts.
   *
   * @param operation  Async function to execute. Must return a result with a
   *                   `failure_classification` field when it fails.
   * @param shouldRetry  Optional predicate — defaults to checking for
   *                     INFRASTRUCTURE_FAILURE classification.
   * @returns          RetryResult with succeeded flag, attempt count, total delay.
   */
  public async execute<
    T extends { status: string; failure_classification?: FailureClassification },
  >(
    operation: () => Promise<T>,
    shouldRetryFn?: (result: T) => boolean
  ): Promise<{ result: T; retry_result: RetryResult }> {
    const isRetryable = shouldRetryFn ?? this.defaultShouldRetry.bind(this);
    const maxAttempts = this.config.max_retries + 1; // convert retries → total attempts

    let totalDelayMs = 0;
    let lastResult: T | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await operation();

      if (result.status === 'success' || !isRetryable(result)) {
        return {
          result,
          retry_result: {
            succeeded: result.status === 'success',
            attempt,
            total_delay_ms: totalDelayMs,
          },
        };
      }

      lastResult = result;

      // Don't sleep after the last attempt
      if (attempt < maxAttempts) {
        const delay = this.calculateDelay(attempt);
        totalDelayMs += delay;
        await sleep(delay);
      }
    }

    return {
      result: lastResult!,
      retry_result: {
        succeeded: false,
        attempt: maxAttempts,
        total_delay_ms: totalDelayMs,
      },
    };
  }

  /**
   * Calculate the delay for a given attempt number using exponential backoff.
   * Exposed publicly so callers can preview the schedule.
   *
   * @param attempt  1-based attempt number (1 = first retry delay, etc.)
   */
  public calculateDelay(attempt: number): number {
    const coreConfig = {
      maxAttempts: this.config.max_retries + 1,
      initialDelayMs: this.config.base_delay_ms,
      maxDelayMs: this.config.max_delay_ms,
      backoffMultiplier: this.config.backoff_multiplier,
    };
    return calculateRetryDelay(attempt, coreConfig);
  }

  /**
   * Check whether the configured max_retries has been exhausted for a
   * given attempt number (1-based). Exhausted when retries used > max_retries.
   */
  public isExhausted(attempt: number): boolean {
    // attempt 1 = 0 retries used, attempt 2 = 1 retry used, etc.
    return attempt - 1 >= this.config.max_retries;
  }

  /**
   * Return the full delay schedule (one entry per retry) for inspection.
   */
  public getDelaySchedule(): number[] {
    return Array.from({ length: this.config.max_retries }, (_, i) => this.calculateDelay(i + 1));
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private defaultShouldRetry<T extends { failure_classification?: FailureClassification }>(
    result: T
  ): boolean {
    return result.failure_classification === FailureClassification.INFRASTRUCTURE_FAILURE;
  }
}

// ============================================================================
// Utility
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
