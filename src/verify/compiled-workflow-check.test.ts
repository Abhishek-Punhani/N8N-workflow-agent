/**
 * AI Data Intelligence Platform - CompiledWorkflowCheck Integration Tests
 *
 * Task 2.6 — Integration tests for the Compiled Workflow Check
 *
 * All tests use Jest spies on the global fetch to mock n8n API responses
 * deterministically — no real n8n instance is required.
 *
 * Test scenarios:
 *  1. Valid workflow accepted by n8n API → status "valid", ValidatedWorkflow returned
 *  2. Invalid workflow rejected by n8n API → status "invalid", errors captured
 *  3. API timeout → status "invalid", API_UNREACHABLE after retries
 *  4. 5xx infrastructure failure → retried, eventual success after transient failure
 *  5. 5xx infrastructure failure → retried, exhausted → API_UNREACHABLE
 *  6. Network error → retried, eventual success
 *  7. Array-form error body parsing → node_id and error_code populated
 *  8. Single-message error body parsing → fallback error shape
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import { CompiledWorkflowCheck } from './compiled-workflow-check.js';
import type { N8NApiConfig } from './compiled-workflow-check.js';
import type { CompiledWorkflowCheckInput } from './types.js';
import type { N8NWorkflow } from '../core/types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal valid N8NWorkflow fixture used across all tests. */
function makeWorkflow(name = 'Test Workflow'): N8NWorkflow {
  return {
    name,
    nodes: [
      {
        id: 'node-1',
        name: 'Acquire-node-1',
        type: 'n8n-nodes-base.HTTPRequest',
        typeVersion: 1,
        position: [0, 0],
        parameters: { url: 'https://example.com', method: 'GET' },
      },
    ],
    connections: {},
    settings: {},
    staticData: { version: 1 },
  };
}

/** Build a CompiledWorkflowCheckInput wrapping the given workflow. */
function makeInput(workflow?: N8NWorkflow): CompiledWorkflowCheckInput {
  return { workflow_json: workflow ?? makeWorkflow() };
}

/** Default test config — points at a non-existent local address so no real calls happen. */
const TEST_CONFIG: N8NApiConfig = {
  baseUrl: 'http://localhost:5678',
  apiKey: 'test-api-key',
  timeoutMs: 5000, // generous for tests; AbortController not invoked by mocked fetch
};

/** Build a Response mock with a JSON body. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Build a Response mock that throws when .json() is called. */
function mockNonJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
    text: () => Promise.resolve('not json'),
  } as unknown as Response;
}

// ============================================================================
// Test suite
// ============================================================================

describe('CompiledWorkflowCheck', () => {
  let checker: CompiledWorkflowCheck;
  let quickChecker: CompiledWorkflowCheck;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    checker = new CompiledWorkflowCheck(TEST_CONFIG);
    // quickChecker uses the same config but is referenced in retry/timeout tests
    // that need backoff sleeps to be controllable via fake timers
    quickChecker = new CompiledWorkflowCheck(TEST_CONFIG);
    // Spy on the global fetch available in Node >=18
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. Valid workflow accepted
  // --------------------------------------------------------------------------

  describe('valid workflow acceptance', () => {
    it('returns status "valid" when the n8n API responds with 200', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, { id: 'wf-1', name: 'Test Workflow' }));

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('valid');
    });

    it('returns a ValidatedWorkflow containing the original workflow JSON', async () => {
      const workflow = makeWorkflow('My Workflow');
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      const result = await checker.validate(makeInput(workflow));

      expect(result.status).toBe('valid');
      expect(result.validated_workflow).toBeDefined();
      expect(result.validated_workflow!.workflow).toEqual(workflow);
    });

    it('ValidatedWorkflow carries a valid ISO timestamp and validator version', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('valid');
      const vw = result.validated_workflow!;

      const parsed = new Date(vw.validated_at);
      expect(parsed.toString()).not.toBe('Invalid Date');
      expect(typeof vw.validated_by).toBe('string');
      expect(vw.validated_by.length).toBeGreaterThan(0);
    });

    it('does not set errors on a successful validation', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      const result = await checker.validate(makeInput());

      expect(result.errors).toBeUndefined();
    });

    it('POSTs to the correct endpoint URL with the correct headers', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      await checker.validate(makeInput());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:5678/api/v1/workflows/validate');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect((init.headers as Record<string, string>)['X-N8N-API-KEY']).toBe('test-api-key');
    });

    it('serialises the workflow JSON as the request body', async () => {
      const workflow = makeWorkflow();
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      await checker.validate(makeInput(workflow));

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual(workflow);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Invalid workflow rejection
  // --------------------------------------------------------------------------

  describe('invalid workflow rejection', () => {
    it('returns status "invalid" when the n8n API responds with 400', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(400, { message: 'Workflow validation failed' }));

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('invalid');
    });

    it('captures a single-message 400 error into errors array', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(400, { message: 'Invalid node configuration' }));

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('invalid');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThanOrEqual(1);
      expect(result.errors![0].message).toContain('Invalid node configuration');
      expect(result.errors![0].error_code).toBe('HTTP_400');
    });

    it('captures array-form 422 errors with node_id and error_code', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(422, {
          errors: [
            { nodeId: 'node-abc', code: 'MISSING_PARAM', message: 'url is required' },
            { nodeId: 'node-def', code: 'INVALID_TYPE', message: 'method must be a string' },
          ],
        })
      );

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('invalid');
      expect(result.errors!.length).toBe(2);

      expect(result.errors![0].node_id).toBe('node-abc');
      expect(result.errors![0].error_code).toBe('MISSING_PARAM');
      expect(result.errors![0].message).toBe('url is required');

      expect(result.errors![1].node_id).toBe('node-def');
      expect(result.errors![1].error_code).toBe('INVALID_TYPE');
    });

    it('populates api_response on each parsed error entry', async () => {
      const rawError = { nodeId: 'node-1', code: 'ERR', message: 'bad node' };
      fetchSpy.mockResolvedValueOnce(mockResponse(422, { errors: [rawError] }));

      const result = await checker.validate(makeInput());

      expect(result.errors![0].api_response).toEqual(rawError);
    });

    it('handles non-JSON 400 body gracefully', async () => {
      fetchSpy.mockResolvedValueOnce(mockNonJsonResponse(400));

      const result = await checker.validate(makeInput());

      expect(result.status).toBe('invalid');
      expect(result.errors!.length).toBeGreaterThanOrEqual(1);
      expect(result.errors![0].error_code).toBe('HTTP_400');
    });

    it('does not retry on 4xx responses', async () => {
      fetchSpy.mockResolvedValue(mockResponse(400, { message: 'Bad request' }));

      await checker.validate(makeInput());

      // 4xx must NOT trigger retries — fetch called exactly once
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 3. API timeout handling
  // --------------------------------------------------------------------------

  describe('API timeout handling', () => {
    it('returns status "invalid" with API_UNREACHABLE after all attempts when fetch always aborts', async () => {
      // Simulate a timeout on every attempt by rejecting with an AbortError
      fetchSpy.mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      );

      // Use fake timers so backoff sleeps resolve instantly via runAllTimersAsync
      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('invalid');
      expect(result.errors).toBeDefined();
      const errorCode = result.errors![0].error_code;
      expect(['API_UNREACHABLE', 'API_ERROR']).toContain(errorCode);
    });

    it('returns status "invalid" with an error message when connection is refused', async () => {
      fetchSpy.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5678'));

      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('invalid');
      expect(result.errors![0].message).toMatch(/ECONNREFUSED|network error|API/i);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Retry on transient 5xx — eventual success
  // --------------------------------------------------------------------------

  describe('retry on transient infrastructure failures', () => {
    it('retries after a 5xx and succeeds on the next attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(503, { message: 'Service unavailable' }))
        .mockResolvedValueOnce(mockResponse(200, {}));

      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('valid');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries up to MAX_ATTEMPTS and returns invalid after all fail with 5xx', async () => {
      fetchSpy.mockResolvedValue(mockResponse(500, { message: 'Internal server error' }));

      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('invalid');
      // Should have attempted 3 times total (MAX_ATTEMPTS = 3)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.errors![0].error_code).toBe('API_UNREACHABLE');
    });

    it('retries after a network error and succeeds on the next attempt', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('Network unreachable'))
        .mockResolvedValueOnce(mockResponse(200, {}));

      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('valid');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does not exceed MAX_ATTEMPTS retries', async () => {
      fetchSpy.mockRejectedValue(new Error('Network unreachable'));

      jest.useFakeTimers();
      const resultPromise = quickChecker.validate(makeInput());
      await jest.runAllTimersAsync();
      await resultPromise;

      // 3 total attempts maximum (requirement 5.4 / platform retry config)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Custom endpoint / config
  // --------------------------------------------------------------------------

  describe('configuration', () => {
    it('respects a custom validationPath', async () => {
      const custom = new CompiledWorkflowCheck({
        ...TEST_CONFIG,
        validationPath: '/api/v2/workflows/check',
      });
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      await custom.validate(makeInput());

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:5678/api/v2/workflows/check');
    });

    it('strips trailing slash from baseUrl', async () => {
      const custom = new CompiledWorkflowCheck({
        ...TEST_CONFIG,
        baseUrl: 'http://localhost:5678/',
      });
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));

      await custom.validate(makeInput());

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('//api');
      expect(url).toBe('http://localhost:5678/api/v1/workflows/validate');
    });
  });
});
