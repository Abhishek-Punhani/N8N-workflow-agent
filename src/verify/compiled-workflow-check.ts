/**
 * AI Data Intelligence Platform - Compiled Workflow Check
 *
 * Validates compiled n8n workflow JSON against the n8n API before deployment.
 * Submits the workflow to the n8n validation endpoint, parses structured
 * validation errors (node_id + error_code), and retries on transient
 * infrastructure failures with exponential backoff.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { N8NWorkflow, N8NValidationError, ValidatedWorkflow } from '../core/types.js';
import type { CompiledWorkflowCheckInput, CompiledWorkflowCheckResult } from './types.js';
import {
  InfrastructureFailureError,
  DEFAULT_RETRY_CONFIGS,
  FailureClassification,
} from '../core/errors.js';
import { DEFAULT_TIMEOUTS, calculateBackoffDelay } from '../core/config.js';

// ============================================================================
// Constants
// ============================================================================

const VALIDATOR_VERSION = '1.0.0';

/**
 * How many total attempts (1 initial + N-1 retries) to make before giving up.
 * Matches the platform-wide retry config for INFRASTRUCTURE_FAILURE (max 3).
 */
const MAX_ATTEMPTS = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE].maxAttempts;

// ============================================================================
// Configuration types
// ============================================================================

/**
 * Connection configuration for the n8n API.
 *
 * The base URL and API key are injected at construction time so this class
 * can be unit-tested with a mock server without touching environment state.
 */
export interface N8NApiConfig {
  /** n8n instance base URL, e.g. "http://localhost:5678" */
  baseUrl: string;
  /** n8n API key (X-N8N-API-KEY header) */
  apiKey: string;
  /**
   * Per-request timeout in milliseconds.
   * Defaults to DEFAULT_TIMEOUTS.CompiledWorkflowCheck (500 ms).
   */
  timeoutMs?: number;
  /**
   * n8n validation endpoint path, relative to baseUrl.
   * Defaults to "/api/v1/workflows/validate".
   */
  validationPath?: string;
}

// ============================================================================
// Raw n8n API response shapes
// ============================================================================

/** Shape of a single error object in n8n's validation error response body. */
interface RawN8NError {
  nodeId?: string;
  node_id?: string;
  code?: string;
  error_code?: string;
  message?: string;
  [key: string]: unknown;
}

/** Shape of the n8n validation error response body. */
interface RawN8NErrorBody {
  message?: string;
  errors?: RawN8NError[];
  [key: string]: unknown;
}

// ============================================================================
// CompiledWorkflowCheck class
// ============================================================================

/**
 * CompiledWorkflowCheck validates a compiled n8n workflow JSON against the
 * n8n instance API before the workflow proceeds to the Contract Check stage.
 *
 * Behaviour:
 *  1. POST the workflow JSON to the n8n validation endpoint.
 *  2. On a 2xx response → wrap in ValidatedWorkflow, return status "valid".
 *  3. On a 4xx response → parse validation errors into N8NValidationError[],
 *     return status "invalid". Not retried (the workflow itself is wrong).
 *  4. On a 5xx response or network error → throw InfrastructureFailureError
 *     and retry with exponential backoff up to MAX_ATTEMPTS total attempts.
 *     After exhausting retries, return status "invalid" with an API_UNREACHABLE
 *     error entry.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class CompiledWorkflowCheck {
  private readonly config: Required<Pick<N8NApiConfig, 'baseUrl' | 'apiKey'>> & {
    timeoutMs: number;
    validationPath: string;
  };

  constructor(config: N8NApiConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // strip trailing slash
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUTS.CompiledWorkflowCheck,
      validationPath: config.validationPath ?? '/api/v1/workflows/validate',
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Validate a compiled n8n workflow against the n8n instance API.
   *
   * @param input - CompiledWorkflowCheckInput containing workflow_json.
   * @returns      CompiledWorkflowCheckResult with status 'valid' or 'invalid'.
   */
  public async validate(input: CompiledWorkflowCheckInput): Promise<CompiledWorkflowCheckResult> {
    const { workflow_json } = input;
    const retryConfig = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE];
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.callValidationEndpoint(workflow_json);
      } catch (err) {
        // Only retry on infrastructure failures (5xx / network errors)
        if (err instanceof InfrastructureFailureError && attempt < MAX_ATTEMPTS) {
          lastError = err;
          const delayMs = calculateBackoffDelay(
            attempt,
            retryConfig.initialDelayMs,
            retryConfig.maxDelayMs,
            retryConfig.backoffMultiplier
          );
          await sleep(delayMs);
          continue;
        }

        // Infrastructure failure on the final attempt — fall through to the
        // post-loop API_UNREACHABLE result so all retry-exhausted paths are consistent.
        if (err instanceof InfrastructureFailureError) {
          lastError = err;
          break;
        }

        // Non-retryable / unexpected throw — surface immediately as API_ERROR.
        return this.buildApiErrorResult(
          'API_ERROR',
          err instanceof Error ? err.message : 'Unknown error calling n8n API'
        );
      }
    }

    // Exhausted all retry attempts
    return this.buildApiErrorResult(
      'API_UNREACHABLE',
      lastError?.message ?? 'n8n API unreachable after all retry attempts'
    );
  }

  // -------------------------------------------------------------------------
  // Private: HTTP call
  // -------------------------------------------------------------------------

  /**
   * Make a single POST call to the n8n validation endpoint.
   *
   * Throws InfrastructureFailureError for network errors and 5xx responses.
   * Returns CompiledWorkflowCheckResult directly for 2xx and 4xx responses.
   */
  private async callValidationEndpoint(
    workflow: N8NWorkflow
  ): Promise<CompiledWorkflowCheckResult> {
    const url = `${this.config.baseUrl}${this.config.validationPath}`;

    // ---- Fire the request with an AbortController timeout ------------------
    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-API-KEY': this.config.apiKey,
          },
          body: JSON.stringify(workflow),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (networkErr) {
      // Network failure or AbortController timeout — retryable
      const message =
        networkErr instanceof Error ? networkErr.message : 'Unknown network error';
      throw new InfrastructureFailureError(
        `n8n API network error: ${message}`,
        { url, timeoutMs: this.config.timeoutMs },
        true
      );
    }

    // ---- 5xx → infrastructure failure, let the retry loop handle it --------
    if (response.status >= 500) {
      throw new InfrastructureFailureError(
        `n8n API returned HTTP ${response.status}`,
        { url, httpStatus: response.status },
        true
      );
    }

    // ---- Parse the response body safely ------------------------------------
    let body: RawN8NErrorBody;
    try {
      body = (await response.json()) as RawN8NErrorBody;
    } catch {
      // Non-JSON body on a non-5xx response
      body = {};
    }

    // ---- 4xx → workflow validation failure, not retryable ------------------
    if (!response.ok) {
      const errors = this.parseValidationErrors(body, response.status);
      return { status: 'invalid', errors };
    }

    // ---- 2xx → success -----------------------------------------------------
    const validatedWorkflow: ValidatedWorkflow = {
      workflow,
      validated_at: new Date().toISOString(),
      validated_by: VALIDATOR_VERSION,
    };

    return { status: 'valid', validated_workflow: validatedWorkflow };
  }

  // -------------------------------------------------------------------------
  // Private: Error parsing
  // -------------------------------------------------------------------------

  /**
   * Parse the n8n validation error response body into a typed
   * N8NValidationError array with node_id and error_code populated.
   *
   * n8n may return errors in one of two shapes:
   *   { errors: [{ nodeId, code, message }] }   (array form)
   *   { message: "..." }                         (single message form)
   */
  private parseValidationErrors(body: RawN8NErrorBody, httpStatus: number): N8NValidationError[] {
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      return body.errors.map((e: RawN8NError) => ({
        node_id: String(e.nodeId ?? e.node_id ?? ''),
        error_code: String(e.code ?? e.error_code ?? `HTTP_${httpStatus}`),
        message: String(e.message ?? JSON.stringify(e)),
        api_response: e,
      }));
    }

    // Fallback: single-message error response
    return [
      {
        node_id: '',
        error_code: `HTTP_${httpStatus}`,
        message: String(body?.message ?? `n8n validation failed with status ${httpStatus}`),
        api_response: body,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private: Helper
  // -------------------------------------------------------------------------

  /** Build a CompiledWorkflowCheckResult for an API-level (non-workflow) failure. */
  private buildApiErrorResult(
    errorCode: string,
    message: string
  ): CompiledWorkflowCheckResult {
    return {
      status: 'invalid',
      errors: [
        {
          node_id: '',
          error_code: errorCode,
          message,
        },
      ],
    };
  }
}

// ============================================================================
// Internal utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
