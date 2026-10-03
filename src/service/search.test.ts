import { searchWeb } from './search';

it('reports failed search engines even when other engines return results', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { url: 'https://official.example/', title: 'Company', content: 'Public business page' },
          ],
          unresponsive_engines: [
            ['google', 'Suspended: CAPTCHA'],
            ['brave', 'too many requests'],
          ],
        })
      )
    );
    const warning = jest.fn();
    const hits = await searchWeb(
      'company query',
      new AbortController().signal,
      { provider: 'searxng', baseUrl: 'http://search:8080', apiKey: '' },
      warning
    );
    expect(hits).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('google unavailable: Suspended: CAPTCHA')
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('brave unavailable: too many requests')
    );
  } finally {
    global.fetch = originalFetch;
  }
});
