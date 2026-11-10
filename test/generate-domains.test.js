import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDomains, domainList, countDomains, CHARSET } from '../src/generate-domains.js';

const N = CHARSET.length;
const first = CHARSET[0];
const last = CHARSET.at(-1);

test('length 1 yields every CHARSET character in order', () => {
  const list = domainList({ length: 1, tld: 'com' });
  assert.deepEqual(list, [...CHARSET].map((c) => `${c}.com`));
});

test('fixed length is complete, unique, and starts/ends at the charset bounds', () => {
  const list = domainList({ length: 2, tld: '.DEV' });
  assert.equal(list.length, N ** 2);
  assert.equal(list[0], `${first}${first}.dev`);
  assert.equal(list.at(-1), `${last}${last}.dev`);
  assert.equal(new Set(list).size, list.length);
  assert.ok(list.every((d) => [...d.slice(0, 2)].every((c) => CHARSET.includes(c))));
});

test('range yields shortest first; limit stops early', () => {
  assert.equal(countDomains([1, 2]), N + N ** 2);
  const out = [...generateDomains({ length: [1, 2], tld: 'io', limit: N + 2 })];
  assert.deepEqual(out.slice(N - 1), [`${last}.io`, `${first}${first}.io`, `${first}${CHARSET[1]}.io`]);
});

test('start resumes inclusively at the given domain', () => {
  const all = domainList({ length: 2, tld: 'link' });
  const resumed = [...generateDomains({ length: 2, tld: 'link', start: 'nv.link' })];
  assert.equal(resumed[0], 'nv.link');
  assert.deepEqual(resumed, all.slice(all.indexOf('nv.link')));
  assert.deepEqual([...generateDomains({ length: 2, tld: 'link', start: 'nv', limit: 2 })], ['nv.link', 'nw.link']);
});

test('start with a range skips shorter lengths, and validates input', () => {
  const out = [...generateDomains({ length: [1, 2], tld: 'io', start: '00', limit: 1 })];
  assert.deepEqual(out, ['00.io']);
  assert.throws(() => [...generateDomains({ length: 2, start: 'abc' })], RangeError);
  assert.throws(() => [...generateDomains({ length: 2, start: 'a-' })], RangeError);
});

test('rejects bad length and oversized arrays', () => {
  assert.throws(() => [...generateDomains({ length: 0 })], RangeError);
  assert.throws(() => domainList({ length: 10 }), RangeError);
  assert.equal(domainList({ length: 10, limit: 3 }).length, 3);
});
