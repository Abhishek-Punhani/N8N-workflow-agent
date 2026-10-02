import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { fetchText, isPublicAddress } from './source';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

function respond(status: number, headers: Record<string, string>, body: string) {
  (request as jest.Mock).mockImplementation(
    (_url: URL, _options: unknown, callback: (response: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      req.destroy = error => {
        req.emit('error', error);
        req.emit('close');
      };
      req.end = () => {
        const res = Object.assign(new EventEmitter(), {
          statusCode: status,
          headers,
          resume: jest.fn(),
        });
        callback(res);
        queueMicrotask(() => {
          res.emit('data', Buffer.from(body));
          res.emit('end');
          req.emit('close');
        });
      };
      return req;
    }
  );
}

describe('Public-network transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (lookup as unknown as jest.Mock).mockImplementation((hostname: string) =>
      Promise.resolve([{ address: hostname === '127.0.0.1' ? '127.0.0.1' : '8.8.8.8', family: 4 }])
    );
  });
  it('revalidates redirect targets before any private-network request', async () => {
    respond(302, { location: 'https://127.0.0.1/secret' }, '');
    await expect(fetchText('https://public.example/')).rejects.toThrow('blocked network');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects insecure redirects', async () => {
    respond(302, { location: 'http://private.example/secret' }, '');
    await expect(fetchText('https://public.example/')).rejects.toThrow('HTTPS');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('pins the resolved address used by the HTTP client', async () => {
    respond(200, { 'content-type': 'text/plain' }, 'public content');
    await expect(fetchText('https://public.example/')).resolves.toMatchObject({
      body: 'public content',
    });
    const options = (request as jest.Mock).mock.calls[0][1] as {
      lookup: (
        host: string,
        options: unknown,
        callback: (error: null, address: string, family: number) => void
      ) => void;
    };
    const callback = jest.fn();
    options.lookup('changed.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
  it('enforces the response byte limit', async () => {
    respond(200, { 'content-type': 'text/plain' }, 'long response');
    await expect(fetchText('https://public.example/', undefined, 3)).rejects.toThrow(
      'byte acquisition limit'
    );
  });
  it.each(['192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1'])(
    'blocks reserved address %s',
    address => expect(isPublicAddress(address)).toBe(false)
  );
});
