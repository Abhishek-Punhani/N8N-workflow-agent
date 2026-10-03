import { GroqLLMClient } from './groq-client';

describe('Groq provider diagnostics', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports a safe provider code without exposing failed generations or messages', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'json_validate_failed',
              message: 'private echoed prompt',
              failed_generation: 'private source data',
            },
          }),
          { status: 400 }
        )
      )
    );
    const client = new GroqLLMClient('test-key', 'configured-model');
    await expect(client.complete('system', 'user', new AbortController().signal)).rejects.toThrow(
      'Groq request failed (HTTP 400, model configured-model, code json_validate_failed)'
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles non-JSON failures without hiding the HTTP status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('upstream unavailable', { status: 403 }));
    const client = new GroqLLMClient('test-key', 'configured-model');
    await expect(client.complete('system', 'user', new AbortController().signal)).rejects.toThrow(
      'Groq request failed (HTTP 403, model configured-model)'
    );
  });
  it('retries a JSON validation rejection once using the same model and token limit', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'json_validate_failed' } }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{"records":[]}' } }],
          })
        )
      );
    const client = new GroqLLMClient('test-key', 'configured-model');
    await expect(
      client.complete('Return a JSON object', 'input', new AbortController().signal, {
        maxOutputTokens: 700,
      })
    ).resolves.toBe('{"records":[]}');
    const requests = (global.fetch as jest.Mock).mock.calls.map(([, options]) =>
      JSON.parse(options.body)
    );
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(request).toMatchObject({ model: 'configured-model', max_completion_tokens: 700 });
    expect(requests[1].messages[0].content).toContain('previous response failed JSON validation');
  });
});
