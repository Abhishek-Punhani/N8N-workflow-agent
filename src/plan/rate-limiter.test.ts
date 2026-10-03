// Promise-based Node timers are not patched by Jest fake timers. Use the same
// cancellation semantics through global timers to test minute windows instantly.
jest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, _value: unknown, options: { signal?: AbortSignal } = {}) =>
    new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
}));

import { RequestRateLimiter, rateLimitFromEnv, sharedRateLimiter } from './rate-limiter';
import { GeminiLLMClient } from './gemini-client';

const signal = () => new AbortController().signal;
const success = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ thought: true, text: 'private thought' }, { text: '{"ok":true}' }] },
        },
      ],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8, thoughtsTokenCount: 20 },
    }),
    { status: 200 }
  );

describe('Shared Gemini quota admission', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('spaces concurrent jobs and admits retries through the same quota', async () => {
    const limiter = new RequestRateLimiter(10);
    const first = await limiter.acquire(10, signal());
    const second = limiter.acquire(10, signal());
    const third = limiter.acquire(10, signal());
    await jest.advanceTimersByTimeAsync(6000);
    expect((await second).at - first.at).toBe(6000);
    await jest.advanceTimersByTimeAsync(6000);
    expect((await third).at).toBe(12000);
  });

  it('counts token usage in a rolling minute and reconciles actual input', async () => {
    const limiter = new RequestRateLimiter(0, 100);
    const first = await limiter.acquire(30, signal());
    limiter.reconcile(first, 80);
    const done = jest.fn();
    const second = limiter.acquire(30, signal()).then(result => {
      done();
      return result;
    });
    await jest.advanceTimersByTimeAsync(59999);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect((await second).at).toBe(60000);
  });

  it('rejects requests exceeding the configured TPM without reserving quota', async () => {
    const limiter = new RequestRateLimiter(10, 100);
    await expect(limiter.acquire(101, signal())).rejects.toThrow('LLM_MAX_TPM');
    expect((await limiter.acquire(20, signal())).at).toBe(0);
  });

  it('cancels queued requests promptly without consuming a future slot', async () => {
    const limiter = new RequestRateLimiter(10);
    await limiter.acquire(10, signal());
    const second = limiter.acquire(10, signal());
    const controller = new AbortController();
    const cancelled = limiter.acquire(10, controller.signal);
    const rejected = expect(cancelled).rejects.toThrow('Cancelled');
    controller.abort(new Error('Cancelled'));
    await rejected;
    const fourth = limiter.acquire(10, signal());
    await jest.advanceTimersByTimeAsync(12000);
    expect((await second).at).toBe(6000);
    expect((await fourth).at).toBe(12000);
  });

  it('shares per-model quotas across clients and rejects invalid configuration', () => {
    expect(sharedRateLimiter('test-model', 10, 100)).toBe(sharedRateLimiter('test-model', 10, 100));
    for (const value of [-1, NaN, Infinity, 1.5])
      expect(() => new RequestRateLimiter(value)).toThrow();
    process.env.TEST_RATE_LIMIT = 'bad';
    expect(() => rateLimitFromEnv('TEST_RATE_LIMIT', 10)).toThrow('TEST_RATE_LIMIT');
    delete process.env.TEST_RATE_LIMIT;
  });

  it('honors server retryDelay above 30 seconds and reports actual usage and retries', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { details: [{ retryDelay: '75s' }] } }), {
          status: 429,
          headers: { 'Retry-After': '45' },
        })
      )
      .mockResolvedValueOnce(success());
    const usage = jest.fn();
    const call = new GeminiLLMClient(
      'test',
      'gemini-3-flash-preview',
      new RequestRateLimiter(10)
    ).complete('system', 'user', signal(), { onUsage: usage });
    await jest.advanceTimersByTimeAsync(74999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toBe('{"ok":true}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledWith({
      requests: 2,
      retries: 1,
      inputTokens: 120,
      outputTokens: 8,
      thinkingTokens: 20,
      throttleWaitMs: 75000,
    });
  });

  it('propagates a 429 cooldown to other concurrent callers', async () => {
    const limiter = new RequestRateLimiter(0);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }))
      .mockImplementation(() => Promise.resolve(success()));
    const first = new GeminiLLMClient('test', 'gemini-3-flash-preview', limiter).complete(
      'system',
      'user',
      signal()
    );
    await jest.advanceTimersByTimeAsync(0);
    const second = new GeminiLLMClient('other-key', 'gemini-3-flash-preview', limiter).complete(
      'system',
      'user',
      signal()
    );
    await jest.advanceTimersByTimeAsync(29999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toBe('{"ok":true}');
    await expect(second).resolves.toBe('{"ok":true}');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('respects HTTP-date Retry-After headers', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 503,
          headers: { 'Retry-After': new Date(45000).toUTCString() },
        })
      )
      .mockResolvedValueOnce(success());
    const call = new GeminiLLMClient(
      'test',
      'gemini-3-flash-preview',
      new RequestRateLimiter(0)
    ).complete('s', 'u', signal());
    await jest.advanceTimersByTimeAsync(44999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toBe('{"ok":true}');
  });

  it('aborts a cooldown without making another HTTP request', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    const controller = new AbortController();
    const call = new GeminiLLMClient(
      'test',
      'gemini-3-flash-preview',
      new RequestRateLimiter(0)
    ).complete('s', 'u', controller.signal);
    const rejected = expect(call).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await jest.advanceTimersByTimeAsync(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds transient retries and sanitizes upstream errors', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'SECRET_USER_CONTENT' } }), {
            status: 429,
          })
        )
      );
    const call = new GeminiLLMClient(
      'test',
      'gemini-3-flash-preview',
      new RequestRateLimiter(0)
    ).complete('s', 'u', signal());
    const rejected = expect(call).rejects.toThrow('Gemini request failed (HTTP 429');
    await jest.advanceTimersByTimeAsync(12000);
    await rejected;
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['MAX_TOKENS', 'SAFETY'])('rejects incomplete responses: %s', async finishReason => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ finishReason, content: { parts: [{ text: '{"partial":true}' }] } }],
          })
        )
      );
    await expect(
      new GeminiLLMClient('test', 'gemini-3-flash-preview', new RequestRateLimiter(0)).complete(
        's',
        'u',
        signal()
      )
    ).rejects.toThrow('did not complete');
  });
});
