/**
 * AI Data Intelligence Platform - n8n API Client
 *
 * Typed interface + HTTP implementation for deploying and activating
 * workflows via the n8n REST API.
 *
 * The interface is injected into Deployer, making it trivially mockable
 * in tests without any real network calls.
 *
 * n8n API endpoints used:
 *   POST   /api/v1/workflows          — create a new workflow
 *   POST   /api/v1/workflows/{id}/activate — activate a created workflow
 */

// ============================================================================
// Interface — the contract Deployer depends on
// ============================================================================

export interface N8NWorkflowCreateResponse {
  id: string; // n8n-assigned workflow ID
  name: string;
  active: boolean;
}

export interface N8NWorkflowActivateResponse {
  id: string;
  active: boolean;
}

export interface N8NApiError {
  status: number;
  message: string;
  code?: string;
}

/**
 * Minimal n8n API client interface.
 * Production: implemented by HttpN8NApiClient below.
 * Tests: replaced by a MockN8NApiClient.
 */
export interface N8NApiClient {
  /**
   * Create a new workflow in the n8n instance.
   * @throws N8NApiError on HTTP error.
   */
  createWorkflow(workflowJson: Record<string, unknown>): Promise<N8NWorkflowCreateResponse>;

  /**
   * Activate a previously created workflow.
   * @throws N8NApiError on HTTP error.
   */
  activateWorkflow(workflowId: string): Promise<N8NWorkflowActivateResponse>;
}

// ============================================================================
// HTTP implementation
// ============================================================================

export interface HttpN8NApiClientConfig {
  /** Base URL of the n8n instance, e.g. http://localhost:5678 */
  baseUrl: string;
  /** n8n API key (set in n8n settings → API keys) */
  apiKey: string;
  /** Request timeout in ms. Default: 30,000 */
  timeoutMs?: number;
}

/**
 * Production n8n API client using Node fetch.
 * Requires Node ≥ 18 (native fetch).
 */
export class HttpN8NApiClient implements N8NApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: HttpN8NApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.headers = {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': config.apiKey,
    };
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  public async createWorkflow(
    workflowJson: Record<string, unknown>
  ): Promise<N8NWorkflowCreateResponse> {
    const response = await this.request('POST', '/api/v1/workflows', workflowJson);
    return response as N8NWorkflowCreateResponse;
  }

  public async activateWorkflow(workflowId: string): Promise<N8NWorkflowActivateResponse> {
    const response = await this.request('POST', `/api/v1/workflows/${workflowId}/activate`, {});
    return response as N8NWorkflowActivateResponse;
  }

  private async request(
    method: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const json = await response.json();

      if (!response.ok) {
        const err = json as { message?: string; code?: string };
        throw {
          status: response.status,
          message: err.message ?? `HTTP ${response.status}`,
          code: err.code,
        } satisfies N8NApiError;
      }

      return json;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw {
          status: 408,
          message: `n8n API request timed out after ${this.timeoutMs}ms`,
        } satisfies N8NApiError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
