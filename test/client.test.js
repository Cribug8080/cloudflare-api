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

test('requires credentials', () => {
  assert.throws(() => new Cloudflare({}));
});
