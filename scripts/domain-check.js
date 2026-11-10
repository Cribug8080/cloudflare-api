#!/usr/bin/env node
// Check domain availability via Cloudflare Registrar, 20 domains per request.
//
// Usage:
//   npm run domain-check -- domains.txt          # one domain per line
//   npm run domain-check -- example.com example.dev
//   cat domains.txt | npm run domain-check -- -
//   npm run domain-check -- -l 2 -t link                     # generate AND check (one command)
//   npm run domain-check -- --start nv.link                  # resume a generated run at nv.link
//                                                            # (generator flags: -l -t -s -n, see src/generate-domains.js)
//   npm run domain-check -- -o out/my-run.json domains.txt   # choose the output file
//   npm run domain-check -- --delay 2000 domains.txt         # ms between batches (default 500)
//
// HTTP 429 / 5xx responses are retried automatically, honoring Retry-After.
//
// Each run saves to a NEW file, results/domain-check-<first>_<last>-<timestamp>.json (override with -o/--out).
// The file starts with a short description (range, TLDs, counts) followed by the results.
// If a run fails, the file records `resumeFrom` and the console prints a command to continue.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Cloudflare, CloudflareError } from '../src/client.js';
import { domainList, parseArgs as parseGeneratorArgs } from '../src/generate-domains.js';

// Same flags as src/generate-domains.js; when present, domains are generated in-process.
const GENERATOR_FLAGS = new Set(['-l', '--length', '-t', '--tld', '-s', '--start', '-n', '--limit']);

const BATCH_SIZE = 20;
// e.g. results/domain-check-nv.link_zz.link-2026-11-09T10-00-00-000Z.json (range + time, so files are self-describing)
const defaultOut = (domains) =>
  `results/domain-check-${domains[0]}_${domains.at(-1)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const DEFAULT_DELAY_MS = 500; // pause between batches to stay under rate limits

function loadDomains(args) {
  const text = (arg) => arg.split(/[\s,]+/);
  const out = [];
  for (const arg of args) {
    if (arg === '-') out.push(...text(readFileSync(0, 'utf8')));
    else if (existsSync(arg)) out.push(...text(readFileSync(arg, 'utf8')));
    else out.push(arg);
  }
  // Drop blanks / comments, normalize, de-duplicate (keeps first-seen order).
  return [...new Set(out.map((d) => d.trim().toLowerCase()).filter((d) => d && !d.startsWith('#')))];
}

// Result shape may be an array or { domains: [...] }; flatten when possible.
const flatten = (r) => (Array.isArray(r) ? r : Array.isArray(r?.domains) ? r.domains : [r]);

function parseArgs(argv) {
  let out; // undefined = pick a descriptive default once the domains are known
  let delayMs = DEFAULT_DELAY_MS;
  const rest = [];
  const genArgs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--out') {
      out = argv[++i];
      if (!out) throw new Error('--out requires a file path');
    }
    else if (argv[i] === '--delay') delayMs = Number(argv[++i]);
    else if (GENERATOR_FLAGS.has(argv[i])) genArgs.push(argv[i], argv[++i]);
    else rest.push(argv[i]);
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('--delay requires milliseconds >= 0');
  return { out, delayMs, inputs: rest, genArgs };
}

function save(path, data) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { delayMs, inputs, genArgs } = args;
  const generated = genArgs.length ? domainList(parseGeneratorArgs(genArgs)) : [];
  const domains = [...new Set([...generated, ...loadDomains(inputs)])];
  const out = args.out ?? (domains.length ? defaultOut(domains) : undefined);
  if (!domains.length) {
    console.error('Usage: npm run domain-check -- [-o results.json] [-l 2 -t link [-s nv.link]] [file | domain ...]');
    process.exitCode = 1;
    return;
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');

  const cf = new Cloudflare({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    onRetry: ({ status, attempt, waitMs }) =>
      console.error(`  HTTP ${status}, retry ${attempt} in ${(waitMs / 1000).toFixed(1)}s...`),
  });
  console.error(`Checking ${domains.length} domain(s) in batches of ${BATCH_SIZE}...`);

  const results = [];
  let done = 0; // domains in fully completed batches
  const tlds = [...new Set(domains.map((d) => d.slice(d.indexOf('.') + 1)))];
  const startedAt = new Date().toISOString();
  const snapshot = (complete, error) => {
    // Result field names aren't guaranteed, so only report availability if entries carry a boolean flag.
    const flag = (r) => r?.registrable ?? r?.available;
    const flagged = results.filter((r) => typeof flag(r) === 'boolean');
    return {
      description: `Cloudflare Registrar domain-check for ${domains[0]} to ${domains.at(-1)} (${domains.length} domains, ${complete ? 'complete' : 'INCOMPLETE'})`,
      startedAt,
      savedAt: new Date().toISOString(),
      first: domains[0],
      last: domains.at(-1),
      tlds,
      requested: domains.length,
      checked: done,
      complete,
      ...(flagged.length && { availableCount: flagged.filter((r) => flag(r)).length }),
      ...(!complete && { resumeFrom: domains[done], error }),
      results,
    };
  };

  try {
    await cf.checkDomains(accountId, domains, {
      batchSize: BATCH_SIZE,
      delayMs,
      onBatch: ({ index, total, domains: d, result }) => {
        results.push(...flatten(result));
        done += d.length;
        console.error(`  batch ${index}/${total} (${d.length} domains) done`);
      },
    });
  } catch (err) {
    // Keep what we already have so a failed batch doesn't lose earlier work.
    save(out, snapshot(false, err.message));
    console.error(`Saved partial results (${results.length}) to ${out}`);
    console.error(`Resume from "${domains[done]}" (the next run writes a new file).`);
    throw err;
  }

  save(out, snapshot(true));
  console.error(`Saved ${results.length} result(s) to ${out}`);
}

main().catch((err) => {
  console.error(err instanceof CloudflareError ? `Cloudflare API error (${err.status}): ${err.message}` : `Error: ${err.message}`);
  process.exitCode = 1;
});
