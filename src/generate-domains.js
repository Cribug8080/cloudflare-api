#!/usr/bin/env node
// Generate domain names from every string of 0-9 and a-z.
//
// CLI:
//   node src/generate-domains.js --length 3 --tld com          # aaa.com ... (one per line)
//   node src/generate-domains.js --length 2-3 --tld dev --json # JSON array
//   node src/generate-domains.js -l 4 -t com | npm run domain-check -- -
//   node src/generate-domains.js --start nv.link               # resume at nv.link (inclusive), same length/TLD
//
// Library:
//   import { generateDomains, domainList } from './generate-domains.js';
//   for (const d of generateDomains({ length: 3, tld: 'com' })) ...
//   const arr = domainList({ length: 2, tld: 'com' });   // fully materialized array
import { fileURLToPath } from 'node:url';

export const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz';
// export const CHARSET = '012abc';
const MAX_LENGTH = 10; // 36^10 still fits exactly in a double
const MAX_ARRAY = 5_000_000;

/**
 * Lazily yields domains for every label of `length` chars (or min..max with
 * `length: [min, max]`), in order: 0..0, 0..1, ... z..z, shortest labels first.
 * Use this for large spaces — 36^4 is 1.7M, 36^5 is 60M.
 */
export function* generateDomains({ length = 3, tld = 'com', limit = Infinity, start } = {}) {
  const [min, max] = Array.isArray(length) ? length : [length, length];
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > MAX_LENGTH) {
    throw new RangeError(`length must be 1..${MAX_LENGTH} (or [min, max])`);
  }
  const suffix = tld ? `.${String(tld).replace(/^\./, '').toLowerCase()}` : '';

  // Resume support: `start` ("nv" or "nv.link") is the first domain to yield (inclusive).
  let startLen = min;
  let startIdx = 0;
  if (start) {
    const label = String(start).toLowerCase().split('.')[0];
    startLen = label.length;
    if (startLen < min || startLen > max) throw new RangeError(`start "${label}" is outside length ${min}..${max}`);
    for (const ch of label) {
      const d = CHARSET.indexOf(ch);
      if (d < 0) throw new RangeError(`start "${label}" contains "${ch}", which is not in the charset`);
      startIdx = startIdx * CHARSET.length + d;
    }
  }

  let count = 0;
  for (let len = startLen; len <= max; len++) {
    const total = CHARSET.length ** len;
    for (let i = len === startLen ? startIdx : 0; i < total; i++) {
      if (count++ >= limit) return;
      // Mixed-radix: map each base-N digit of i to CHARSET (works for any charset).
      let label = '';
      for (let n = i, k = 0; k < len; k++, n = Math.floor(n / CHARSET.length)) {
        label = CHARSET[n % CHARSET.length] + label;
      }
      yield label + suffix;
    }
  }
}

/** Number of domains generateDomains would produce (before `limit`). */
export function countDomains(length = 3) {
  const [min, max] = Array.isArray(length) ? length : [length, length];
  let n = 0;
  for (let len = min; len <= max; len++) n += CHARSET.length ** len;
  return n;
}

/** Same as generateDomains but returns an array; refuses huge spaces. */
export function domainList(opts = {}) {
  const n = Math.min(countDomains(opts.length ?? 3), opts.limit ?? Infinity);
  if (n > MAX_ARRAY) throw new RangeError(`${n} domains is too many for an array; iterate generateDomains() or set limit`);
  return [...generateDomains(opts)];
}

// ---- CLI ----
export function parseArgs(argv) {
  const opts = { length: 3, tld: 'com', limit: Infinity, json: false };
  let lengthSet = false;
  let tldSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-l' || a === '--length') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(next() ?? '');
      if (!m) throw new Error('--length must be N or MIN-MAX');
      opts.length = m[2] ? [Number(m[1]), Number(m[2])] : Number(m[1]);
      lengthSet = true;
    } else if (a === '-t' || a === '--tld') { opts.tld = next(); tldSet = true; }
    else if (a === '-s' || a === '--start') opts.start = next();
    else if (a === '-n' || a === '--limit') opts.limit = Number(next());
    else if (a === '--json') opts.json = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  // `--start nv.link` alone is enough: infer the TLD and label length from it.
  if (opts.start) {
    const [label, ...rest] = String(opts.start).split('.');
    if (!tldSet && rest.length) opts.tld = rest.join('.');
    if (!lengthSet) opts.length = label.length;
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { json, ...opts } = parseArgs(process.argv.slice(2));
    if (json) {
      console.log(JSON.stringify(domainList(opts)));
    } else {
      // Stream so large spaces don't build up in memory; stop quietly on a closed pipe.
      process.stdout.on('error', (e) => e.code === 'EPIPE' && process.exit(0));
      for (const d of generateDomains(opts)) process.stdout.write(d + '\n');
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
