import { chromium } from 'playwright-core';
import { fetchText, checkSourceAccess, assertSafeUrl, type HttpBody } from './source.js';

/** A fresh browser context per acquisition. Every HTTP request is served by the
 * DNS-pinned public-network transport, including scripts, XHRs and redirects. */
export async function renderPage(url: string, signal: AbortSignal): Promise<HttpBody> {
  assertSafeUrl(url);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-quic',
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  });
  const abort = () => {
    void browser.close();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    let requests = 0;
    let bytes = 0;
    let mainError: unknown;
    let finalUrl = url;
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      try {
        if (
          ++requests > 80 ||
          bytes > 25_000_000 ||
          request.method() !== 'GET' ||
          ['image', 'font', 'media'].includes(request.resourceType())
        ) {
          await route.abort();
          return;
        }
        const response = await fetchText(request.url(), '*/*', 3_000_000, 0, signal);
        bytes += Buffer.byteLength(response.body);
        if (request.isNavigationRequest() && request.frame() === context.pages()[0]?.mainFrame())
          finalUrl = response.url;
        if (request.isNavigationRequest() && response.url !== request.url()) {
          await route.fulfill({ status: 302, headers: { location: response.url } });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: response.contentType,
          body: response.body,
        });
      } catch (error) {
        if (request.isNavigationRequest()) mainError = error;
        await route.abort().catch(() => undefined);
      }
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (error) {
      throw mainError ?? error;
    }
    // Permit hydration to settle, bounded even on continuously polling pages.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    if (mainError) throw mainError;
    const body = await page.content();
    if (body.length > 3_000_000) throw new Error('Rendered page exceeds content limit');
    checkSourceAccess(body, 200);
    return { body, url: finalUrl, status: 200, contentType: 'text/html' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    await browser.close();
  }
}
