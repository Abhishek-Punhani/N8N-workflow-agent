/**
 * AI Data Intelligence Platform - Sandbox Executor Tests
 *
 * Covers every execution path in the Sandbox class:
 *  1. Successful execution — sample output returned
 *  2. Empty workflow — no crash, empty output
 *  3. Fixture injection — fixture data flows through nodes
 *  4. Node chaining — output of node N feeds node N+1
 *  5. Timeout enforcement — exceeding budget → failure + INFRASTRUCTURE_FAILURE
 *  6. Logic error — thrown Error during processing → LOGIC_FAILURE trace
 *  7. External source errors (404/503/DNS) → EXTERNAL_SOURCE_FAILURE
 *  8. Infrastructure error messages → INFRASTRUCTURE_FAILURE
 *  9. Failure trace shape — all required fields present and correct
 * 10. Head node — synthetic record from node parameters
 *
 * Requirements: 7.1, 7.2, 7.7
 */

import { Sandbox, SandboxTimeoutError } from './sandbox.js';
import { FailureClassification } from '../core/errors.js';
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
  return { name: 'Test', nodes, connections: {}, settings: {}, staticData: {} };
}

function makeInput(
  nodes: N8NNode[],
  fixtures: TestFixture[] = [],
  timeout_ms?: number
): SandboxInput {
  return { workflow_json: makeWorkflow(nodes), test_fixtures: fixtures, timeout_ms };
}

// ============================================================================
// StalledSandbox
//
// A subclass that exposes an executeStalledWithTimeout() helper.
// It calls the (protected) runWithTimeout() with a never-resolving Promise
// so the timer always fires first — the only reliable way to test timeouts
// when the real executeWorkflow is synchronous.
// ============================================================================

class StalledSandbox extends Sandbox {
  async executeStalledWithTimeout(timeoutMs: number): Promise<SandboxResult> {
    const executedAt = new Date().toISOString();
    try {
      // Cast to any to access private runWithTimeout — acceptable in tests.
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
// Tests
// ============================================================================

describe('Sandbox', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = new Sandbox();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. Successful execution
  // --------------------------------------------------------------------------

  describe('successful execution', () => {
    it('returns status "success" for a valid single-node workflow', async () => {
      const result = await sandbox.execute(makeInput([makeNode('n1', 'Acquire')]));
      expect(result.status).toBe('success');
    });

    it('returns a non-empty sample_output array', async () => {
      const result = await sandbox.execute(makeInput([makeNode('n1', 'Acquire')]));
      expect(Array.isArray(result.sample_output)).toBe(true);
      expect(result.sample_output!.length).toBeGreaterThan(0);
    });

    it('does not set failure fields on success', async () => {
      const result = await sandbox.execute(makeInput([makeNode('n1', 'Acquire')]));
      expect(result.failure_classification).toBeUndefined();
      expect(result.failure_trace).toBeUndefined();
    });

    it('sets executed_at to a valid ISO date string', async () => {
      const result = await sandbox.execute(makeInput([makeNode('n1', 'Acquire')]));
      expect(isNaN(new Date(result.executed_at).getTime())).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Empty workflow
  // --------------------------------------------------------------------------

  describe('empty workflow', () => {
    it('returns status "success" with empty sample_output', async () => {
      const result = await sandbox.execute(makeInput([]));
      expect(result.status).toBe('success');
      expect(result.sample_output).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Fixture injection
  // --------------------------------------------------------------------------

  describe('fixture injection', () => {
    it('uses fixture data as the node input', async () => {
      const fixture: TestFixture = {
        step_id: 'n1',
        mock_data: [{ name: 'OpenAI', founded: 2015 }],
      };
      const result = await sandbox.execute(makeInput([makeNode('n1', 'Acquire')], [fixture]));

      expect(result.status).toBe('success');
      expect(result.sample_output![0]['name']).toBe('OpenAI');
      expect(result.sample_output![0]['founded']).toBe(2015);
    });

    it('fixture data propagates through downstream nodes', async () => {
      const fixture: TestFixture = {
        step_id: 'n1',
        mock_data: [{ company: 'Anthropic' }],
      };
      const nodes = [makeNode('n1', 'Acquire'), makeNode('n2', 'Extract')];
      const result = await sandbox.execute(makeInput(nodes, [fixture]));

      expect(result.status).toBe('success');
      expect(result.sample_output![0]['company']).toBe('Anthropic');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Node chaining
  // --------------------------------------------------------------------------

  describe('node chaining', () => {
    it('threads output through a 2-node chain', async () => {
      const nodes = [makeNode('n1', 'Acquire'), makeNode('n2', 'Extract')];
      const result = await sandbox.execute(makeInput(nodes));

      expect(result.status).toBe('success');
      // Last node should have tagged the record
      expect(result.sample_output![0]['_node']).toBe('Extract');
    });

    it('returns the last node output for a 3-node chain', async () => {
      const nodes = [
        makeNode('n1', 'Acquire'),
        makeNode('n2', 'Extract'),
        makeNode('n3', 'Deliver', 'n8n-nodes-base.Webhook'),
      ];
      const result = await sandbox.execute(makeInput(nodes));

      expect(result.status).toBe('success');
      expect(result.sample_output![0]['_node']).toBe('Deliver');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Timeout enforcement
  // --------------------------------------------------------------------------

  describe('timeout enforcement', () => {
    it('returns status "failure" when execution never completes within the timeout', async () => {
      jest.useFakeTimers();
      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(1);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failure');
    });

    it('classifies timeout as INFRASTRUCTURE_FAILURE', async () => {
      jest.useFakeTimers();
      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(1);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.failure_classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
    });

    it('failure_trace message contains "timed out"', async () => {
      jest.useFakeTimers();
      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(1);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.failure_trace).toBeDefined();
      expect(result.failure_trace!.error_message).toMatch(/timed out/i);
    });

    it('failure_trace classification is INFRASTRUCTURE_FAILURE', async () => {
      jest.useFakeTimers();
      const s = new StalledSandbox();
      const resultPromise = s.executeStalledWithTimeout(1);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.failure_trace!.classification).toBe(
        FailureClassification.INFRASTRUCTURE_FAILURE
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. Logic error → LOGIC_FAILURE
  // --------------------------------------------------------------------------

  describe('logic failure', () => {
    class BrokenSandbox extends Sandbox {
      protected override processNode(): Record<string, any>[] {
        throw new Error('Invalid field mapping — cannot coerce string to number');
      }
    }

    it('returns status "failure" when a node throws a generic error', async () => {
      const result = await new BrokenSandbox().execute(makeInput([makeNode('n1', 'Extract')]));
      expect(result.status).toBe('failure');
      expect(result.failure_classification).toBe(FailureClassification.LOGIC_FAILURE);
    });

    it('captures the error message in failure_trace', async () => {
      class MsgSandbox extends Sandbox {
        protected override processNode(): Record<string, any>[] {
          throw new Error('field mapping error');
        }
      }
      const result = await new MsgSandbox().execute(makeInput([makeNode('n1', 'Extract')]));
      expect(result.failure_trace!.error_message).toBe('field mapping error');
    });
  });

  // --------------------------------------------------------------------------
  // 7. External source errors → EXTERNAL_SOURCE_FAILURE
  // --------------------------------------------------------------------------

  describe('external source failure', () => {
    const externalMessages = [
      'HTTP 404 not found',
      'HTTP 503 service unavailable',
      'DNS lookup failed for api.example.com',
      'ENOTFOUND external source',
      'connection refused by external source',
      'gateway timeout from upstream',
    ];

    for (const msg of externalMessages) {
      it(`classifies "${msg}" as EXTERNAL_SOURCE_FAILURE`, async () => {
        class ErrorSandbox extends Sandbox {
          protected override processNode(): Record<string, any>[] {
            throw new Error(msg);
          }
        }
        const result = await new ErrorSandbox().execute(makeInput([makeNode('n1', 'Acquire')]));
        expect(result.status).toBe('failure');
        expect(result.failure_classification).toBe(FailureClassification.EXTERNAL_SOURCE_FAILURE);
      });
    }
  });

  // --------------------------------------------------------------------------
  // 8. Infrastructure errors → INFRASTRUCTURE_FAILURE
  // --------------------------------------------------------------------------

  describe('infrastructure failure', () => {
    const infraMessages = [
      'network error occurred',
      'socket hang up',
      'ECONNRESET by peer',
      'internal server error 500',
      'out of memory',
      'memory limit exceeded',
    ];

    for (const msg of infraMessages) {
      it(`classifies "${msg}" as INFRASTRUCTURE_FAILURE`, async () => {
        class ErrorSandbox extends Sandbox {
          protected override processNode(): Record<string, any>[] {
            throw new Error(msg);
          }
        }
        const result = await new ErrorSandbox().execute(makeInput([makeNode('n1', 'Acquire')]));
        expect(result.status).toBe('failure');
        expect(result.failure_classification).toBe(FailureClassification.INFRASTRUCTURE_FAILURE);
      });
    }
  });

  // --------------------------------------------------------------------------
  // 9. Failure trace shape
  // --------------------------------------------------------------------------

  describe('failure trace shape', () => {
    class BrokenSandbox extends Sandbox {
      protected override processNode(): Record<string, any>[] {
        throw new Error('something broke');
      }
    }

    it('failure_trace has all required fields with correct types', async () => {
      const result = await new BrokenSandbox().execute(makeInput([makeNode('n1', 'Acquire')]));
      const trace = result.failure_trace!;

      expect(typeof trace.step_id).toBe('string');
      expect(typeof trace.error_message).toBe('string');
      expect(trace.error_message.length).toBeGreaterThan(0);
      expect(isNaN(new Date(trace.timestamp).getTime())).toBe(false);
      expect(trace.retry_count).toBe(0);
      expect(typeof trace.classification).toBe('string');
    });

    it('failure_trace.classification matches failure_classification on the result', async () => {
      const result = await new BrokenSandbox().execute(makeInput([makeNode('n1', 'Acquire')]));
      expect(result.failure_trace!.classification).toBe(result.failure_classification);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Head node — synthetic record from parameters
  // --------------------------------------------------------------------------

  describe('head node (no fixture, no upstream)', () => {
    it('produces a synthetic record containing node parameters', async () => {
      const node = makeNode('n1', 'Discover');
      const result = await sandbox.execute(makeInput([node]));

      expect(result.status).toBe('success');
      expect(result.sample_output![0]['url']).toBe('https://example.com/n1');
      expect(result.sample_output![0]['method']).toBe('GET');
    });

    it('synthetic record includes _node and _node_type metadata', async () => {
      const node = makeNode('n1', 'Discover');
      const result = await sandbox.execute(makeInput([node]));

      expect(result.sample_output![0]['_node']).toBe('Discover');
      expect(result.sample_output![0]['_node_type']).toBe('n8n-nodes-base.HTTPRequest');
    });
  });
});

// ============================================================================
// SandboxTimeoutError
// ============================================================================

describe('SandboxTimeoutError', () => {
  it('is an instance of Error', () => {
    expect(new SandboxTimeoutError('t')).toBeInstanceOf(Error);
  });

  it('has name SandboxTimeoutError', () => {
    expect(new SandboxTimeoutError('t').name).toBe('SandboxTimeoutError');
  });

  it('carries the message', () => {
    expect(new SandboxTimeoutError('timed out after 500ms').message).toBe('timed out after 500ms');
  });
});
