/**
 * AI Data Intelligence Platform - Response Classifier
 *
 * Classifies HTTP responses to detect:
 * - Rate limiting (429, Retry-After headers)
 * - CAPTCHA challenges (reCAPTCHA, Cloudflare, hCaptcha)
 * - Bot blocking (anti-automation detection)
 * - Authentication failures (401, 403)
 * - Source availability issues
 *
 * Used by Acquire capability to determine failure handling strategy.
 */

import { ExternalSourceFailureReason } from '@core/errors.js';

// ============================================================================
// Response Types
// ============================================================================

export interface HTTPResponse {
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  body: string;
  url: string;
}

export type ResponseClassification =
  | { type: 'SUCCESS'; data: unknown }
  | { type: 'RATE_LIMITED'; retryAfter: number; reason: string }
  | { type: 'CAPTCHA_DETECTED'; captchaType: CaptchaType; indicators: string[] }
  | { type: 'BOT_BLOCKED'; reason: string; indicators: string[] }
  | { type: 'AUTH_REQUIRED'; authType: 'credentials' | 'token' | 'unknown' }
  | { type: 'NOT_FOUND'; resource: string }
  | { type: 'SOURCE_DOWN'; reason: string }
  | { type: 'TIMEOUT'; duration: number }
  | { type: 'UNKNOWN_FAILURE'; status: number; reason: string };

export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'cloudflare' | 'custom';

// ============================================================================
// Response Classifier
// ============================================================================

export class ResponseClassifier {
  /**
   * Classify an HTTP response to determine handling strategy
   */
  classify(response: HTTPResponse): ResponseClassification {
    // Success responses (2xx)
    if (response.status >= 200 && response.status < 300) {
      return {
        type: 'SUCCESS',
        data: this.parseResponseBody(response.body),
      };
    }

    // Rate limiting (429)
    if (response.status === 429) {
      return this.classifyRateLimited(response);
    }

    // Authentication failures (401, 403)
    if (response.status === 401 || response.status === 403) {
      return this.classifyAuthFailure(response);
    }

    // Not found (404)
    if (response.status === 404) {
      return {
        type: 'NOT_FOUND',
        resource: response.url,
      };
    }

    // Server errors (500-599)
    if (response.status >= 500) {
      return this.classifyServerError(response);
    }

    // Timeout (status 0 or timeout-related)
    if (response.status === 0 || response.statusText.toLowerCase().includes('timeout')) {
      return {
        type: 'TIMEOUT',
        duration: 0, // Would be set by HTTP client
      };
    }

    // Unknown failure
    return {
      type: 'UNKNOWN_FAILURE',
      status: response.status,
      reason: response.statusText,
    };
  }

  /**
   * Classify rate-limited responses
   */
  private classifyRateLimited(response: HTTPResponse): ResponseClassification {
    const retryAfter = this.parseRetryAfter(response.headers);

    return {
      type: 'RATE_LIMITED',
      retryAfter,
      reason: response.statusText || 'Too Many Requests',
    };
  }

  /**
   * Classify authentication/authorization failures
   * Distinguishes between:
   * - Invalid credentials (401)
   * - Bot blocking (403 + CAPTCHA indicators)
   * - Insufficient permissions (403)
   */
  private classifyAuthFailure(response: HTTPResponse): ResponseClassification {
    // Check for CAPTCHA indicators
    const captchaDetection = this.detectCaptcha(response.body, response.headers);
    if (captchaDetection) {
      return captchaDetection;
    }

    // Check for bot blocking indicators
    const botBlockDetection = this.detectBotBlocking(response.body, response.headers);
    if (botBlockDetection) {
      return botBlockDetection;
    }

    // Standard authentication failure
    return {
      type: 'AUTH_REQUIRED',
      authType: response.status === 401 ? 'credentials' : 'unknown',
    };
  }

  /**
   * Classify server errors
   */
  private classifyServerError(response: HTTPResponse): ResponseClassification {
    return {
      type: 'SOURCE_DOWN',
      reason: `Server error: ${response.status} ${response.statusText}`,
    };
  }

  /**
   * Detect CAPTCHA challenges in response
   */
  private detectCaptcha(
    body: string,
    headers: Record<string, string | string[]>
  ): ResponseClassification | null {
    const bodyLower = body.toLowerCase();
    const indicators: string[] = [];

    // reCAPTCHA v2/v3
    if (bodyLower.includes('recaptcha') || bodyLower.includes('google.com/recaptcha')) {
      indicators.push('recaptcha');
      return {
        type: 'CAPTCHA_DETECTED',
        captchaType: bodyLower.includes('recaptcha/api2') ? 'recaptcha_v2' : 'recaptcha_v3',
        indicators,
      };
    }

    // hCaptcha
    if (bodyLower.includes('hcaptcha') || bodyLower.includes('h-captcha')) {
      indicators.push('hcaptcha');
      return {
        type: 'CAPTCHA_DETECTED',
        captchaType: 'hcaptcha',
        indicators,
      };
    }

    // Cloudflare challenge
    if (
      bodyLower.includes('cf-challenge') ||
      bodyLower.includes('cloudflare') ||
      bodyLower.includes('checking your browser') ||
      headers['cf-ray'] ||
      headers['CF-Ray']
    ) {
      indicators.push('cloudflare');
      return {
        type: 'CAPTCHA_DETECTED',
        captchaType: 'cloudflare',
        indicators,
      };
    }

    // Generic CAPTCHA indicators
    if (
      bodyLower.includes('verify you are human') ||
      bodyLower.includes('prove you are human') ||
      bodyLower.includes('captcha') ||
      bodyLower.includes('bot protection')
    ) {
      indicators.push('generic_captcha');
      return {
        type: 'CAPTCHA_DETECTED',
        captchaType: 'custom',
        indicators,
      };
    }

    return null;
  }

  /**
   * Detect bot blocking/anti-automation in response
   */
  private detectBotBlocking(
    body: string,
    headers: Record<string, string | string[]>
  ): ResponseClassification | null {
    const bodyLower = body.toLowerCase();
    const indicators: string[] = [];

    // Common bot blocking patterns
    const botBlockPatterns = [
      'access denied',
      'blocked by administrator',
      'suspicious activity',
      'automated access',
      'bot detected',
      'you have been blocked',
      'ip has been blocked',
      'unusual traffic',
      'temporarily blocked',
    ];

    for (const pattern of botBlockPatterns) {
      if (bodyLower.includes(pattern)) {
        indicators.push(pattern);
      }
    }

    // Check for anti-bot headers
    if (headers['x-robots-tag'] === 'noindex, nofollow') {
      indicators.push('robots_header');
    }

    if (indicators.length > 0) {
      return {
        type: 'BOT_BLOCKED',
        reason: 'Anti-automation protection detected',
        indicators,
      };
    }

    return null;
  }

  /**
   * Parse Retry-After header to get retry delay in seconds
   */
  private parseRetryAfter(headers: Record<string, string | string[]>): number {
    const retryAfter = headers['retry-after'] || headers['Retry-After'];

    if (!retryAfter) {
      return 60; // Default to 60 seconds
    }

    const retryAfterStr = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;

    // Try to parse as number (seconds)
    const seconds = parseInt(retryAfterStr, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }

    // Try to parse as HTTP date
    try {
      const retryDate = new Date(retryAfterStr);
      const now = new Date();
      const diff = Math.max(0, (retryDate.getTime() - now.getTime()) / 1000);
      return Math.ceil(diff);
    } catch {
      return 60; // Fallback to 60 seconds
    }
  }

  /**
   * Parse response body (JSON or text)
   */
  private parseResponseBody(body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  /**
   * Map classification to ExternalSourceFailureReason
   */
  static toFailureReason(classification: ResponseClassification): ExternalSourceFailureReason {
    switch (classification.type) {
      case 'RATE_LIMITED':
        return ExternalSourceFailureReason.RATE_LIMITED;
      case 'CAPTCHA_DETECTED':
        return ExternalSourceFailureReason.CAPTCHA;
      case 'BOT_BLOCKED':
        return ExternalSourceFailureReason.BOT_BLOCKED;
      case 'AUTH_REQUIRED':
        return ExternalSourceFailureReason.AUTH_REQUIRED;
      case 'NOT_FOUND':
        return ExternalSourceFailureReason.NOT_FOUND;
      case 'SOURCE_DOWN':
        return ExternalSourceFailureReason.SOURCE_DOWN;
      case 'TIMEOUT':
        return ExternalSourceFailureReason.TIMEOUT;
      default:
        return ExternalSourceFailureReason.UNKNOWN;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a response classification should trigger retry
 */
export function shouldRetryResponse(classification: ResponseClassification): boolean {
  switch (classification.type) {
    case 'RATE_LIMITED':
    case 'SOURCE_DOWN':
    case 'TIMEOUT':
      return true;
    case 'CAPTCHA_DETECTED':
    case 'BOT_BLOCKED':
    case 'AUTH_REQUIRED':
    case 'NOT_FOUND':
      return false;
    default:
      return false;
  }
}

/**
 * Get recommended retry delay for a classification
 */
export function getRetryDelay(classification: ResponseClassification): number {
  switch (classification.type) {
    case 'RATE_LIMITED':
      return classification.retryAfter * 1000; // Convert to ms
    case 'SOURCE_DOWN':
      return 5000; // 5 seconds
    case 'TIMEOUT':
      return 10000; // 10 seconds
    default:
      return 0;
  }
}

/**
 * Check if classification indicates source should be marked unavailable
 */
export function shouldMarkSourceUnavailable(classification: ResponseClassification): boolean {
  return (
    classification.type === 'CAPTCHA_DETECTED' ||
    classification.type === 'BOT_BLOCKED' ||
    classification.type === 'NOT_FOUND'
  );
}
