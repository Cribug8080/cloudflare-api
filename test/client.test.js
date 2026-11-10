import test from 'node:test';
import assert from 'node:assert/strict';
import { Cloudflare, CloudflareError } from '../src/client.js';

const mockFetch = (responses) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = responses.shift();
    return new Response(JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
};

test('sends bearer token and returns result', async () => {
  const f = mockFetch([{ body: { success: true, result: { status: 'active' } } }]);
  const cf = new Cloudflare({ apiToken: 't0k', fetch: f });
  assert.deepEqual(await cf.verifyToken(), { status: 'active' });
  assert.equal(f.calls[0].url, 'https://api.cloudflare.com/client/v4/user/tokens/verify');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer t0k');
});

test('paginates across pages', async () => {
  const f = mockFetch([
    { body: { success: true, result: [{ id: 1 }], result_info: { total_pages: 2 } } },
    { body: { success: true, result: [{ id: 2 }], result_info: { total_pages: 2 } } },
  ]);
  const cf = new Cloudflare({ apiToken: 'x', fetch: f });
  assert.deepEqual(await cf.listZones(), [{ id: 1 }, { id: 2 }]);
  assert.match(f.calls[1].url, /page=2/);
});

test('throws CloudflareError on API failure', async () => {
  const f = mockFetch([{ status: 403, body: { success: false, errors: [{ code: 9109, message: 'Invalid access token' }] } }]);
  const cf = new Cloudflare({ apiToken: 'bad', fetch: f });
  await assert.rejects(cf.listZones(), (e) => e instanceof CloudflareError && e.status === 403 && /9109/.test(e.message));
});

test('checkDomains sends 20 domains per request', async () => {
  const domains = Array.from({ length: 45 }, (_, i) => `d${i}.com`);
  const f = mockFetch(Array.from({ length: 3 }, () => ({ body: { success: true, result: [] } })));
  const cf = new Cloudflare({ apiToken: 'x', fetch: f });
  await cf.checkDomains('acct', domains);
  const sizes = f.calls.map((c) => JSON.parse(c.init.body).domains.length);
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.equal(f.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct/registrar/domain-check');
  assert.equal(f.calls[0].init.method, 'POST');
});

test('retries on 429 honoring Retry-After, then succeeds', async () => {
  const waits = [];
  let n = 0;
  const f = async () =>
    n++ < 2
      ? new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '3' } })
      : new Response(JSON.stringify({ success: true, result: 'ok' }));
  const cf = new Cloudflare({ apiToken: 'x', fetch: f, sleep: async (ms) => waits.push(ms) });
  assert.equal(await cf.request('GET', '/x'), 'ok');
  assert.equal(n, 3);
  assert.ok(waits.every((w) => w >= 3000 && w < 3300));
});

test('gives up after maxRetries on persistent 429', async () => {
  let n = 0;
  const f = async () => (n++, new Response('nope', { status: 429 }));
  const cf = new Cloudflare({ apiToken: 'x', fetch: f, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(cf.request('GET', '/x'), (e) => e.status === 429);
  assert.equal(n, 3);
});

test('requires credentials', () => {
  assert.throws(() => new Cloudflare({}));
});
