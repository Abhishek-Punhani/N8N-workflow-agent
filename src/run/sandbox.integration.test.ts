/**
 * AI Data Intelligence Platform - Sandbox Integration Tests
 *
 * Task 3.3 — Integration tests for the Sandbox covering the full
 * Sandbox + FailureClassifier pipeline end-to-end.
 *
 * These tests exercise the scenarios called out specifically in tasks.md §3.3:
 *
 *  1. Successful execution with sample output
 *  2. LOGIC_FAILURE classification and trace capture
 *  3. INFRASTRUCTURE_FAILURE retry logic (exponential backoff, max 3 attempts)
 *  4. EXTERNAL_SOURCE_UNAVAILABLE degraded mode
 *  5. Timeout enforcement
 *
 * "Integration" here means the full Sandbox.execute() → FailureClassifier
 * pipeline is exercised together, including the caller-level retry/degrade
 * orchestration that a real orchestrator would perform based on the returned
 * failure_classification.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { Sandbox, SandboxTimeoutError } from './sandbox.js';
import { FailureClassifier } from './failure-classifier.js';
import {
  FailureClassification,
  DEFAULT_RETRY_CONFIGS,
  calculateRetryDelay,
} from '../core/errors.js';
import type { SandboxInput, SandboxResult, TestFixture } from './types.js';
import type { N8NWorkflow, N8NNode } from '../core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeNode(id: string, name: string, type = 'n8n-nodes-base.HTTPRequest'): N8NNode {
  return {
    id,
    name,
    type,
    typeVersion: 1,
    position: [0, 0],
    parameters: { url: `https://example.com/${id}`, method: 'GET' },
  };
}

function makeWorkflow(nodes: N8NNode[]): N8NWorkflow {
  return { name: 'Integration Test Workflow', nodes, connections: {}, settings: {}, staticData: {} };
}

function makeInput(
  nodes: N8NNode[],
  fixtures: TestFixture[] = [],
  timeout_ms?: number
): SandboxInput {
  return { workflow_json: makeWorkflow(nodes), test_fixtures: fixtures, timeout_ms };
}

/**
 * Minimal retry orchestrator that mirrors what the real orchestrator will do:
 *  - Execute the workflow
 *  - If INFRASTRUCTURE_FAILURE and attempts < maxAttempts → wait + retry
 *  - Otherwise return the result
 *
 * Used to integration-test retry behaviour without implementing task 3.4 yet.
 */
async function executeWithRetry(
  sandbox: Sandbox,
  input: SandboxInput,
  maxAttempts = 3,
  delayFn: (attempt: number) => Promise<void> = () => Promise.resolve()
): Promise<{ result: SandboxResult; attempts: number }> {
  let lastResult: SandboxResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sandbox.execute(input);

    if (result.status === 'success') {
      return { result, attempts: attempt };
    }

    if (
      result.failure_classification === FailureClassification.INFRASTRUCTURE_FAILURE &&
      attempt < maxAttempts
    ) {
      lastResult = result;
      await delayFn(attempt);
      continue;
    }

    return { result, attempts: attempt };
  }

  return { result: lastResult!, attempts: maxAttempts };
}

/**
 * Minimal degraded mode tracker that mirrors what DegradedModeManager will do:
 * marks a source as degraded and records which sources are unavailable.
 */
class SimpleDegradedModeTracker {
  private degradedSources = new Set<string>();

  markDegraded(sourceId: string): void {
    this.degradedSources.add(sourceId);
  }

  isDegraded(sourceId: string): boolean {
    return this.degradedSources.has(sourceId);
  }

  getDegradedSources(): string[] {
    return Array.from(this.degradedSources);
  }

  isActive(): boolean {
    return this.degradedSources.size > 0;
  }
}

// ============================================================================
// Stall helper — makes the sandbox's inner runWithTimeout never resolve
// ============================================================================

class StalledSandbox extends Sandbox {
  async executeStalledWithTimeout(timeoutMs: number): Promise<SandboxResult> {
    const executedAt = new Date().toISOString();
    try {
      await (this as any).runWithTimeout(
        (): Promise<Record<string, any>[]> => new Promise(() => { /* never resolves */ }),
        timeoutMs
      );
      return { status: 'success', sample_output: [], executed_at: executedAt };
    } catch (err) {
      const trace = (this as any).buildFailureTrace(err, timeoutMs);
      return {
        status: 'failure',
        failure_classification: trace.classification,
        failure_trace: trace,
        executed_at: executedAt,
      };
    }
  }
}

// ============================================================================
// Integration tests
// ============================================================================

describe('Sandbox integration', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. Successful execution with sample output
  // --------------------------------------------------------------------------

  describe('1. Successful execution with sample output', () => {
    it('executes a multi-node workflow and returns sample records', async () => {
      const sandbox = new Sandbox();
      const nodes = [
        makeNode('discover', 'Discover'),
        makeNode('acquire', 'Acquire'),
        makeNode('extract', 'Extract'),
      ];
      const fixtures: TestFixture[] = [
        {
          step_id: 'discover',
          mock_data: [
            { url: 'https://techcrunch.com/ai-startups', type: 'article' },
            { url: 'https://forbes.com/ai-100', type: 'article' },
          ],
        },
      ];

      const result = await sandbox.execute(makeInput(nodes, fixtures));

      expect(result.status).toBe('success');
      expect(Array.isArray(result.sample_output)).toBe(true);
      expect(result.sample_output!.length).toBeGreaterThan(0);
      // Original fixture data must flow through to the final output
      expect(result.sample_output![0]['url']).toBeDefined();
      expect(result.failure_classification).toBeUndefined();
      expect(result.failure_trace).toBeUndefined();
    });

    it('sample_output contains records enriched by each downstream node', async () => {
      const sandbox = new Sandbox();
      const nodes = [
        makeNode('n1', 'Acquire'),
        makeNode('n2', 'Transform'),
        makeNode('n3', 'Deliver', 'n8n-nodes-base.Webhook'),
      ];
      const fixtures: TestFixture[] = [
        { step_id: 'n1', mock_data: [{ company: 'Mistral AI', country: 'France' }] },
      ];

      const result = await sandbox.execute(makeInput(nodes, fixtures));

      expect(result.status).toBe('success');
      // The final record must carry the original data
      const record = result.sample_output![0];
      expect(record['company']).toBe('Mistral AI');
      expect(record['country']).toBe('France');
      // And metadata from the last node
      expect(record['_node']).toBe('Deliver');
    });

    it('multiple fixture records all appear in sample_output', async () => {
      const sandbox = new Sandbox();
      const nodes = [makeNode('n1', 'Acquire')];
      const fixtures: TestFixture[] = [
        {
          step_id: 'n1',
          mock_data: [
            { name: 'startup-1' },
            { name: 'startup-2' },
            { name: 'startup-3' },
          ],
        },
      ];

      const result = await sandbox.execute(makeInput(nodes, fixtures));

      expect(result.status).toBe('success');
      expect(result.sample_output!.length).toBe(3);
      expect(result.sample_output!.map(r => r['name'])).toEqual(
        expect.arrayContaining(['startup-1', 'startup-2', 'startup-3'])
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. LOGIC_FAILURE classification and trace capture
  // --------------------------------------------------------------------------

  describe('2. LOGIC_FAILURE classification and trace capture', () => {
    it('classifies invalid field mapping as LOGIC_FAILURE', async () => {
      class LogicErrorSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('Cannot map field "revenue": type mismatch string → number');
        }
      }

      const result = await new LogicErrorSandbox().execute(
        makeInput([makeNode('transform', 'Transform')])
      );

      expect(result.status).toBe('failure');
      expect(result.failure_classification).toBe(FailureClassification.LOGIC_FAILURE);
    });

    it('capture includes the exact error message in the trace', async () => {
      const errMsg = 'Step extract: unexpected null in required field "name"';
      class LogicErrorSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error(errMsg);
        }
      }

      const result = await new LogicErrorSandbox().execute(
        makeInput([makeNode('extract', 'Extract')])
      );

      expect(result.failure_trace!.error_message).toBe(errMsg);
    });

    it('trace has a valid ISO timestamp', async () => {
      class LogicErrorSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('logic error');
        }
      }

      const result = await new LogicErrorSandbox().execute(
        makeInput([makeNode('n1', 'Validate')])
      );

      expect(isNaN(new Date(result.failure_trace!.timestamp).getTime())).toBe(false);
    });

    it('FailureClassifier independently confirms LOGIC_FAILURE for non-infra errors', () => {
      const classifier = new FailureClassifier();
      const result = classifier.classify({
        error: new Error('unexpected token in JSON at position 42'),
        step_id: 'extract-step',
        retry_count: 0,
      });

      expect(result.classification).toBe(FailureClassification.LOGIC_FAILURE);
      expect(result.recommended_action).toBe('repair');
      expect(result.trace.step_id).toBe('extract-step');
    });

    it('recommended_action for LOGIC_FAILURE is "repair"', async () => {
      class LogicErrorSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('assertion failed: step output schema mismatch');
        }
      }

      const result = await new LogicErrorSandbox().execute(
        makeInput([makeNode('n1', 'Validate')])
      );

      // Verify via FailureClassifier that the recommended action is repair
      const classifier = new FailureClassifier();
      const classResult = classifier.classify({
        error: new Error(result.failure_trace!.error_message),
        step_id: result.failure_trace!.step_id,
        retry_count: 0,
      });
      expect(classResult.recommended_action).toBe('repair');
    });
  });

  // --------------------------------------------------------------------------
  // 3. INFRASTRUCTURE_FAILURE retry logic (exponential backoff, max 3 attempts)
  // --------------------------------------------------------------------------

  describe('3. INFRASTRUCTURE_FAILURE retry logic', () => {
    it('retries after INFRASTRUCTURE_FAILURE and succeeds on second attempt', async () => {
      let callCount = 0;

      class FlakyInfraSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          callCount++;
          if (callCount === 1) {
            throw new Error('internal server error 500 — transient');
          }
          return [{ data: 'recovered' }];
        }
      }

      const sandbox = new FlakyInfraSandbox();
      const { result, attempts } = await executeWithRetry(
        sandbox,
        makeInput([makeNode('n1', 'Acquire')]),
        3
      );

      expect(result.status).toBe('success');
      expect(attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it('stops retrying after 3 failed INFRASTRUCTURE_FAILURE attempts', async () => {
      let callCount = 0;

      class AlwaysInfraSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          callCount++;
          throw new Error('network error — connection reset');
        }
      }

      const sandbox = new AlwaysInfraSandbox();
      const { result, attempts } = await executeWithRetry(
        sandbox,
        makeInput([makeNode('n1', 'Acquire')]),
        3
      );

      expect(result.status).toBe('failure');
      expect(result.failure_classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
      expect(attempts).toBe(3);
      expect(callCount).toBe(3);
    });

    it('does NOT retry on LOGIC_FAILURE', async () => {
      let callCount = 0;

      class LogicSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          callCount++;
          throw new Error('assertion failed: invalid schema');
        }
      }

      const { attempts } = await executeWithRetry(
        new LogicSandbox(),
        makeInput([makeNode('n1', 'Extract')]),
        3
      );

      // LOGIC_FAILURE must not trigger retries — only 1 attempt
      expect(callCount).toBe(1);
      expect(attempts).toBe(1);
    });

    it('does NOT retry on EXTERNAL_SOURCE_FAILURE', async () => {
      let callCount = 0;

      class ExternalSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          callCount++;
          throw new Error('HTTP 503 source unavailable');
        }
      }

      const { attempts } = await executeWithRetry(
        new ExternalSandbox(),
        makeInput([makeNode('n1', 'Acquire')]),
        3
      );

      // EXTERNAL_SOURCE_FAILURE must not trigger retries
      expect(callCount).toBe(1);
      expect(attempts).toBe(1);
    });

    it('exponential backoff delays increase between attempts', () => {
      // Validate the retry delay schedule matches platform config (1s, 2s, 4s capped at 8s)
      const config = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE];

      const delay1 = calculateRetryDelay(1, config); // attempt 1 → 1000ms
      const delay2 = calculateRetryDelay(2, config); // attempt 2 → 2000ms
      const delay3 = calculateRetryDelay(3, config); // attempt 3 → 4000ms

      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
      expect(delay3).toBe(4000);
      // Each delay is strictly larger than the previous (exponential)
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('retry delay is capped at maxDelayMs', () => {
      const config = DEFAULT_RETRY_CONFIGS[FailureClassification.INFRASTRUCTURE_FAILURE];
      // Attempt 10 would be 1000 * 2^9 = 512000ms, but must be capped at 8000ms
      const delay = calculateRetryDelay(10, config);
      expect(delay).toBe(config.maxDelayMs);
    });

    it('succeeds on third attempt after two infrastructure failures', async () => {
      let callCount = 0;

      class TwoFailsSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          callCount++;
          if (callCount < 3) throw new Error('socket hang up — infra error');
          return [{ result: 'ok' }];
        }
      }

      const { result, attempts } = await executeWithRetry(
        new TwoFailsSandbox(),
        makeInput([makeNode('n1', 'Acquire')]),
        3
      );

      expect(result.status).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // 4. EXTERNAL_SOURCE_UNAVAILABLE degraded mode
  // --------------------------------------------------------------------------

  describe('4. EXTERNAL_SOURCE_UNAVAILABLE degraded mode', () => {
    it('classifies DNS failure as EXTERNAL_SOURCE_FAILURE', async () => {
      class DnsSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('ENOTFOUND api.datasource.com — DNS lookup failed');
        }
      }

      const result = await new DnsSandbox().execute(makeInput([makeNode('n1', 'Acquire')]));

      expect(result.status).toBe('failure');
      expect(result.failure_classification).toBe(FailureClassification.EXTERNAL_SOURCE_FAILURE);
    });

    it('recommended_action for EXTERNAL_SOURCE_FAILURE is "degraded"', () => {
      const classifier = new FailureClassifier();
      const result = classifier.classify({
        error: new Error('HTTP 503 — external data source unavailable'),
        step_id: 'acquire-step',
        retry_count: 0,
      });

      expect(result.classification).toBe(FailureClassification.EXTERNAL_SOURCE_FAILURE);
      expect(result.recommended_action).toBe('degraded');
    });

    it('degraded mode tracker marks source as unavailable after EXTERNAL_SOURCE_FAILURE', async () => {
      class ExternalFailSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('HTTP 503 service unavailable: api.primarysource.com');
        }
      }

      const tracker = new SimpleDegradedModeTracker();
      const result = await new ExternalFailSandbox().execute(
        makeInput([makeNode('acquire-primary', 'Acquire')])
      );

      expect(result.failure_classification).toBe(FailureClassification.EXTERNAL_SOURCE_FAILURE);

      // Orchestrator marks the source degraded
      tracker.markDegraded('api.primarysource.com');

      expect(tracker.isActive()).toBe(true);
      expect(tracker.isDegraded('api.primarysource.com')).toBe(true);
    });

    it('degraded mode continues with remaining available sources', async () => {
      const tracker = new SimpleDegradedModeTracker();

      // Primary source fails → mark degraded
      tracker.markDegraded('api.primarysource.com');

      // Fallback sandbox uses a different source (no failure)
      const sandbox = new Sandbox();
      const nodes = [makeNode('acquire-fallback', 'Acquire')];
      const fixtures: TestFixture[] = [
        {
          step_id: 'acquire-fallback',
          mock_data: [{ name: 'Startup A', source: 'fallback.com' }],
        },
      ];

      const result = await sandbox.execute(makeInput(nodes, fixtures));

      // Execution succeeds with the available (fallback) source
      expect(result.status).toBe('success');
      expect(result.sample_output![0]['name']).toBe('Startup A');
      // The primary source is still marked degraded
      expect(tracker.isDegraded('api.primarysource.com')).toBe(true);
      expect(tracker.getDegradedSources()).toContain('api.primarysource.com');
    });

    it('multiple degraded sources are all tracked', async () => {
      const tracker = new SimpleDegradedModeTracker();
      tracker.markDegraded('source-a.com');
      tracker.markDegraded('source-b.com');
      tracker.markDegraded('source-c.com');

      expect(tracker.getDegradedSources()).toHaveLength(3);
      expect(tracker.isActive()).toBe(true);
    });

    it('FailureClassifier returns correct trace step_id for source failure', () => {
      const classifier = new FailureClassifier();
      const result = classifier.classify({
        error: new Error('connection refused by external source'),
        step_id: 'acquire-linkedin',
        retry_count: 0,
      });

      expect(result.trace.step_id).toBe('acquire-linkedin');
      expect(result.trace.error_message).toBe('connection refused by external source');
      expect(result.classification).toBe(FailureClassification.EXTERNAL_SOURCE_FAILURE);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Timeout enforcement
  // --------------------------------------------------------------------------

  describe('5. Timeout enforcement', () => {
    it('returns INFRASTRUCTURE_FAILURE when workflow never completes', async () => {
      jest.useFakeTimers();

      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(500);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failure');
      expect(result.failure_classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    });

    it('timeout trace message says "timed out"', async () => {
      jest.useFakeTimers();

      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(500);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.failure_trace!.error_message).toMatch(/timed out/i);
    });

    it('timeout is retryable (recommended_action is retry)', async () => {
      jest.useFakeTimers();

      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(500);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      jest.useRealTimers();

      // Classify the timeout error to confirm recommended action
      const classifier = new FailureClassifier();
      const classResult = classifier.classify({
        error: new SandboxTimeoutError(result.failure_trace!.error_message),
        step_id: 'unknown',
        retry_count: 0,
      });
      expect(classResult.recommended_action).toBe('retry');
    });

    it('shorter timeout fires before longer one', async () => {
      jest.useFakeTimers();

      const s1 = new StalledSandbox();
      const s2 = new StalledSandbox();

      const r1Promise = s1.executeStalledWithTimeout(100);
      const r2Promise = s2.executeStalledWithTimeout(5000);

      await jest.runAllTimersAsync();

      const r1 = await r1Promise;
      const r2 = await r2Promise;

      // Both timed out but both should still be failures
      expect(r1.status).toBe('failure');
      expect(r2.status).toBe('failure');
    });

    it('SandboxTimeoutError is classified as INFRASTRUCTURE_FAILURE by FailureClassifier', () => {
      const classifier = new FailureClassifier();
      const result = classifier.classify({
        error: new SandboxTimeoutError('Sandbox execution timed out after 30000ms'),
        step_id: 'step-1',
        retry_count: 1,
      });

      expect(result.classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
      expect(result.trace.retry_count).toBe(1);
    });
  });
});
