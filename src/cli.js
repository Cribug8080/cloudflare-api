#!/usr/bin/env node
import { Cloudflare, CloudflareError } from './client.js';

const USAGE = `Usage: npm start -- <command> [args]

Commands:
  verify                         Verify the API token
  accounts                       List accounts
  zones                          List zones
  dns <zoneId>                   List DNS records for a zone
  request <METHOD> <path> [json] Call any endpoint, e.g.
                                 request GET /zones
                                 request POST /zones/<id>/dns_records '{"type":"A","name":"a.example.com","content":"1.2.3.4"}'

Auth (env): CLOUDFLARE_API_TOKEN  (or CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY)`;

const print = (v) => console.log(JSON.stringify(v, null, 2));

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') return console.log(USAGE);

  const cf = new Cloudflare({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    email: process.env.CLOUDFLARE_EMAIL,
    apiKey: process.env.CLOUDFLARE_API_KEY,
  });

  switch (cmd) {
    case 'verify': return print(await cf.verifyToken());
    case 'accounts': return print(await cf.listAccounts());
    case 'zones': return print((await cf.listZones()).map(({ id, name, status }) => ({ id, name, status })));
    case 'dns': {
      if (!args[0]) throw new Error('dns requires <zoneId>');
      return print((await cf.listDnsRecords(args[0])).map(({ id, type, name, content, proxied }) => ({ id, type, name, content, proxied })));
    }
    case 'request': {
      const [method, path, json] = args;
      if (!method || !path) throw new Error('request requires <METHOD> <path>');
      return print(await cf.request(method, path, { body: json ? JSON.parse(json) : undefined }));
    }
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof CloudflareError ? `Cloudflare API error (${err.status}): ${err.message}` : `Error: ${err.message}`);
  process.exitCode = 1;
});
