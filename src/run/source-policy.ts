/**
 * AI Data Intelligence Platform - Source Policy
 *
 * Defines execution policies for external data sources including:
 * - Rate limiting
 * - Retry strategies
 * - Authentication requirements
 * - Failure handling (CAPTCHA, bot blocks, etc.)
 *
 * This layer sits between capabilities and n8n execution,
 * ensuring safe and compliant data acquisition.
 */

import { ExternalSourceFailureReason } from '@core/errors.js';

// ============================================================================
// Source Policy Types
// ============================================================================

/**
 * Access method for a data source
 */
export type SourceAccessMethod = 'api' | 'web_scraping' | 'file' | 'database';

/**
 * Policy for handling specific failure types
 */
export type FailureHandlingStrategy = 'retry' | 'degrade' | 'switch_source' | 'fail';

/**
 * Comprehensive policy for accessing an external data source
 */
export interface SourcePolicy {
  /** Unique identifier for the source */
  source_id: string;

  /** Display name for logging/dashboard */
  source_name: string;

  /** How the source should be accessed */
  access_method: SourceAccessMethod;

  /** Rate limiting configuration */
  rate_limit?: {
    /** Maximum requests per second */
    requests_per_second?: number;
    /** Maximum requests per minute */
    requests_per_minute?: number;
    /** Maximum requests per hour */
    requests_per_hour?: number;
    /** Maximum burst size (requests allowed in quick succession) */
    burst_limit?: number;
  };

  /** Retry policy configuration */
  retry_policy?: {
    /** Maximum retry attempts */
    max_attempts: number;
    /** Backoff strategy */
    backoff: 'fixed' | 'exponential' | 'linear';
    /** Initial delay in milliseconds */
    initial_delay_ms: number;
    /** Maximum delay in milliseconds */
    max_delay_ms: number;
    /** Backoff multiplier (for exponential) */
    backoff_multiplier?: number;
  };

  /** Authentication requirements */
  authentication?: {
    /** Whether authentication is required */
    required: boolean;
    /** Type of authentication */
    type?: 'api_key' | 'oauth' | 'basic' | 'bearer' | 'custom';
    /** Reference to credential store (never store actual credentials) */
    credential_ref?: string;
  };

  /** Timeout configuration */
  timeout?: {
    /** Request timeout in milliseconds */
    request_timeout_ms: number;
    /** Connection timeout in milliseconds */
    connection_timeout_ms?: number;
  };

  /** Pagination support */
  pagination?: {
    /** Whether source supports pagination */
    enabled: boolean;
    /** Pagination method */
    method?: 'offset' | 'cursor' | 'page';
    /** Maximum items per page */
    max_per_page?: number;
  };

  /** Handling strategies for specific failure types */
  failure_handling: {
    [K in ExternalSourceFailureReason]?: FailureHandlingStrategy;
  };

  /** Default strategy when no specific handler defined */
  default_failure_strategy: FailureHandlingStrategy;

  /** Health check configuration */
  health_check?: {
    /** Enable health checking */
    enabled: boolean;
    /** Health check interval in milliseconds */
    interval_ms: number;
    /** Endpoint to check */
    endpoint?: string;
  };

  /** Metadata for observability */
  metadata?: {
    /** Source description */
    description?: string;
    /** Source owner/provider */
    provider?: string;
    /** Last successful access timestamp */
    last_accessed?: string;
    /** Current health status */
    health_status?: 'healthy' | 'degraded' | 'unavailable';
    /** Tags for categorization */
    tags?: string[];
  };
}

// ============================================================================
// Default Policies
// ============================================================================

/**
 * Default policy for API sources
 */
export const DEFAULT_API_POLICY: Partial<SourcePolicy> = {
  access_method: 'api',
  rate_limit: {
    requests_per_second: 2,
    requests_per_minute: 100,
    burst_limit: 5,
  },
  retry_policy: {
    max_attempts: 3,
    backoff: 'exponential',
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
  },
  timeout: {
    request_timeout_ms: 30000,
    connection_timeout_ms: 10000,
  },
  failure_handling: {
    [ExternalSourceFailureReason.RATE_LIMITED]: 'retry',
    [ExternalSourceFailureReason.CAPTCHA]: 'fail',
    [ExternalSourceFailureReason.BOT_BLOCKED]: 'fail',
    [ExternalSourceFailureReason.AUTH_REQUIRED]: 'fail',
    [ExternalSourceFailureReason.SOURCE_DOWN]: 'retry',
    [ExternalSourceFailureReason.TIMEOUT]: 'retry',
  },
  default_failure_strategy: 'degrade',
};

/**
 * Default policy for web scraping sources
 */
export const DEFAULT_WEB_SCRAPING_POLICY: Partial<SourcePolicy> = {
  access_method: 'web_scraping',
  rate_limit: {
    requests_per_second: 1,
    requests_per_minute: 30,
    burst_limit: 2,
  },
  retry_policy: {
    max_attempts: 2,
    backoff: 'exponential',
    initial_delay_ms: 2000,
    max_delay_ms: 60000,
    backoff_multiplier: 3,
  },
  timeout: {
    request_timeout_ms: 60000,
    connection_timeout_ms: 15000,
  },
  failure_handling: {
    [ExternalSourceFailureReason.RATE_LIMITED]: 'retry',
    [ExternalSourceFailureReason.CAPTCHA]: 'switch_source',
    [ExternalSourceFailureReason.BOT_BLOCKED]: 'switch_source',
    [ExternalSourceFailureReason.ROBOTS_RESTRICTED]: 'fail',
    [ExternalSourceFailureReason.AUTH_REQUIRED]: 'degrade',
    [ExternalSourceFailureReason.SOURCE_DOWN]: 'retry',
    [ExternalSourceFailureReason.TIMEOUT]: 'degrade',
  },
  default_failure_strategy: 'degrade',
};

// ============================================================================
// Source Policy Manager
// ============================================================================

export class SourcePolicyManager {
  private policies: Map<string, SourcePolicy> = new Map();

  /**
   * Register a source policy
   */
  registerPolicy(policy: SourcePolicy): void {
    this.policies.set(policy.source_id, policy);
  }

  /**
   * Get policy for a source (returns default if not found)
   */
  getPolicy(sourceId: string): SourcePolicy {
    const policy = this.policies.get(sourceId);
    if (!policy) {
      return this.createDefaultPolicy(sourceId);
    }
    return policy;
  }

  /**
   * Check if a source should be retried based on failure reason
   */
  shouldRetry(sourceId: string, failureReason: ExternalSourceFailureReason): boolean {
    const policy = this.getPolicy(sourceId);
    const strategy = policy.failure_handling[failureReason] || policy.default_failure_strategy;

    return strategy === 'retry';
  }

  /**
   * Get handling strategy for a specific failure
   */
  getHandlingStrategy(
    sourceId: string,
    failureReason: ExternalSourceFailureReason
  ): FailureHandlingStrategy {
    const policy = this.getPolicy(sourceId);
    return policy.failure_handling[failureReason] || policy.default_failure_strategy;
  }

  /**
   * Calculate backoff delay for retry attempt
   */
  getBackoffDelay(sourceId: string, attemptNumber: number): number {
    const policy = this.getPolicy(sourceId);
    const retryPolicy = policy.retry_policy;

    if (!retryPolicy) {
      return 1000; // Default 1 second
    }

    let delay = retryPolicy.initial_delay_ms;

    switch (retryPolicy.backoff) {
      case 'fixed':
        delay = retryPolicy.initial_delay_ms;
        break;
      case 'linear':
        delay = retryPolicy.initial_delay_ms * attemptNumber;
        break;
      case 'exponential':
        delay =
          retryPolicy.initial_delay_ms *
          Math.pow(retryPolicy.backoff_multiplier || 2, attemptNumber - 1);
        break;
    }

    return Math.min(delay, retryPolicy.max_delay_ms);
  }

  /**
   * Check if retry attempts exhausted
   */
  isRetryExhausted(sourceId: string, attemptNumber: number): boolean {
    const policy = this.getPolicy(sourceId);
    return attemptNumber >= (policy.retry_policy?.max_attempts || 0);
  }

  /**
   * Get rate limit for source
   */
  getRateLimit(sourceId: string): SourcePolicy['rate_limit'] {
    const policy = this.getPolicy(sourceId);
    return policy.rate_limit;
  }

  /**
   * Update source health status
   */
  updateHealthStatus(sourceId: string, status: 'healthy' | 'degraded' | 'unavailable'): void {
    const policy = this.policies.get(sourceId);
    if (policy && policy.metadata) {
      policy.metadata.health_status = status;
      policy.metadata.last_accessed = new Date().toISOString();
    }
  }

  /**
   * Create a default policy for an unknown source
   */
  private createDefaultPolicy(sourceId: string): SourcePolicy {
    return {
      source_id: sourceId,
      source_name: sourceId,
      access_method: 'api',
      ...DEFAULT_API_POLICY,
      failure_handling: DEFAULT_API_POLICY.failure_handling || {},
      default_failure_strategy: 'degrade',
    };
  }

  /**
   * Get all registered policies
   */
  getAllPolicies(): SourcePolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Remove a source policy
   */
  removePolicy(sourceId: string): boolean {
    return this.policies.delete(sourceId);
  }

  /**
   * Check if policy exists for source
   */
  hasPolicy(sourceId: string): boolean {
    return this.policies.has(sourceId);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a policy for an API source
 */
export function createApiSourcePolicy(
  sourceId: string,
  sourceName: string,
  options?: Partial<SourcePolicy>
): SourcePolicy {
  return {
    source_id: sourceId,
    source_name: sourceName,
    ...DEFAULT_API_POLICY,
    ...options,
    access_method: 'api',
    failure_handling: {
      ...DEFAULT_API_POLICY.failure_handling,
      ...options?.failure_handling,
    },
    default_failure_strategy: options?.default_failure_strategy || 'degrade',
  };
}

/**
 * Create a policy for a web scraping source
 */
export function createWebScrapingSourcePolicy(
  sourceId: string,
  sourceName: string,
  options?: Partial<SourcePolicy>
): SourcePolicy {
  return {
    source_id: sourceId,
    source_name: sourceName,
    ...DEFAULT_WEB_SCRAPING_POLICY,
    ...options,
    access_method: 'web_scraping',
    failure_handling: {
      ...DEFAULT_WEB_SCRAPING_POLICY.failure_handling,
      ...options?.failure_handling,
    },
    default_failure_strategy: options?.default_failure_strategy || 'degrade',
  };
}
