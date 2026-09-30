/**
 * AI Data Intelligence Platform - RetryHandler Tests
 *
 * Requirements: 7.5, 13.3
 */

import { RetryHandler } from './retry-handler.js';
import { FailureClassification } from '../core/errors.js';

type FakeResult = { status: 'success' | 'failure'; failure_classification?: FailureClassification };

describe('RetryHandler', () => {
  afterEach(() => jest.useRealTimers());

  // -------------------------------------------------------------------------
  // Default config
  // -------------------------------------------------------------------------

  it('succeeds immediately without retrying when operation succeeds first time', async () => {
    jest.useFakeTimers();
    const handler = new RetryHandler();
    let calls = 0;

    const { result, retry_result } = await handler.execute(async () => {
      calls++;
      return { status: 'success' as const };
    });

    expect(result.status).toBe('success');
    expect(retry_result.succeeded).toBe(true);
    expect(retry_result.attempt).toBe(1);
    expect(calls).toBe(1);
  });

  it('retries on INFRASTRUCTURE_FAILURE and succeeds on second attempt', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const handler = new RetryHandler();

    const promise = handler.execute(async (): Promise<FakeResult> => {
      calls++;
      if (calls === 1) return { status: 'failure', failure_classification: FailureClassification.INFRASTRUCTURE_FAILURE };
      return { status: 'success' };
    });
    await jest.runAllTimersAsync();
    const { result, retry_result } = await promise;

    expect(result.status).toBe('success');
    expect(retry_result.attempt).toBe(2);
    expect(calls).toBe(2);
  });

  it('retries up to max_retries times and returns last failure', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const handler = new RetryHandler();

    const promise = handler.execute(async (): Promise<FakeResult> => {
      calls++;
      return { status: 'failure', failure_classification: FailureClassification.INFRASTRUCTURE_FAILURE };
    });
    await jest.runAllTimersAsync();
    const { result, retry_result } = await promise;

    expect(result.status).toBe('failure');
    // Default: 2 retries → 3 total attempts
    expect(calls).toBe(3);
    expect(retry_result.attempt).toBe(3);
    expect(retry_result.succeeded).toBe(false);
  });

  it('does NOT retry on LOGIC_FAILURE', async () => {
    let calls = 0;
    const handler = new RetryHandler();

    const { result, retry_result } = await handler.execute(async (): Promise<FakeResult> => {
      calls++;
      return { status: 'failure', failure_classification: FailureClassification.LOGIC_FAILURE };
    });

    expect(calls).toBe(1);
    expect(retry_result.attempt).toBe(1);
    expect(result.failure_classification).toBe(FailureClassification.LOGIC_FAILURE);
  });

  it('does NOT retry on EXTERNAL_SOURCE_FAILURE', async () => {
    let calls = 0;
    const handler = new RetryHandler();

    const { retry_result } = await handler.execute(async (): Promise<FakeResult> => {
      calls++;
      return { status: 'failure', failure_classification: FailureClassification.EXTERNAL_SOURCE_FAILURE };
    });

    expect(calls).toBe(1);
    expect(retry_result.attempt).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Delay schedule
  // -------------------------------------------------------------------------

  it('getDelaySchedule returns exponentially increasing delays', () => {
    const handler = new RetryHandler();
    const schedule = handler.getDelaySchedule();

    expect(schedule.length).toBe(2); // 2 retries by default
    expect(schedule[0]).toBe(1000);  // 1s
    expect(schedule[1]).toBe(2000);  // 2s
  });

  it('delays are capped at max_delay_ms', () => {
    const handler = new RetryHandler({ max_retries: 10, base_delay_ms: 1000, max_delay_ms: 4000, backoff_multiplier: 2 });
    const schedule = handler.getDelaySchedule();
    expect(Math.max(...schedule)).toBe(4000);
  });

  it('calculateDelay returns correct exponential value', () => {
    const handler = new RetryHandler();
    expect(handler.calculateDelay(1)).toBe(1000);
    expect(handler.calculateDelay(2)).toBe(2000);
    expect(handler.calculateDelay(3)).toBe(4000);
  });

  it('tracks total_delay_ms across retries', async () => {
    jest.useFakeTimers();
    const handler = new RetryHandler();

    const promise = handler.execute(async (): Promise<FakeResult> => ({
      status: 'failure',
      failure_classification: FailureClassification.INFRASTRUCTURE_FAILURE,
    }));
    await jest.runAllTimersAsync();
    const { retry_result } = await promise;

    // 2 sleeps: 1000ms + 2000ms = 3000ms
    expect(retry_result.total_delay_ms).toBe(3000);
  });

  // -------------------------------------------------------------------------
  // Custom config
  // -------------------------------------------------------------------------

  it('respects custom max_retries', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const handler = new RetryHandler({ max_retries: 1 });

    const promise = handler.execute(async (): Promise<FakeResult> => {
      calls++;
      return { status: 'failure', failure_classification: FailureClassification.INFRASTRUCTURE_FAILURE };
    });
    await jest.runAllTimersAsync();
    await promise;

    expect(calls).toBe(2); // 1 initial + 1 retry
  });

  it('accepts a custom shouldRetry predicate', async () => {
    let calls = 0;
    const handler = new RetryHandler({ max_retries: 2, base_delay_ms: 0 });

    const { retry_result } = await handler.execute(
      async (): Promise<FakeResult> => {
        calls++;
        return { status: 'failure', failure_classification: FailureClassification.LOGIC_FAILURE };
      },
      // Custom predicate: retry even on LOGIC_FAILURE
      () => true
    );

    expect(calls).toBe(3);
    expect(retry_result.attempt).toBe(3);
  });

  // -------------------------------------------------------------------------
  // isExhausted
  // -------------------------------------------------------------------------

  it('isExhausted returns false before max_retries', () => {
    const handler = new RetryHandler({ max_retries: 2 });
    expect(handler.isExhausted(1)).toBe(false);
    expect(handler.isExhausted(2)).toBe(false);
  });

  it('isExhausted returns true after max_retries', () => {
    const handler = new RetryHandler({ max_retries: 2 });
    expect(handler.isExhausted(3)).toBe(true);
    expect(handler.isExhausted(4)).toBe(true);
  });
});
