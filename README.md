# Cloudflare API client (Node)

Zero-dependency Node (>=20.6) client + CLI for the [Cloudflare REST API](https://developers.cloudflare.com/api/).

## Setup

```bash
cp .env.example .env   # then put your API token in .env
npm start -- verify
```

## CLI

```bash
npm start -- zones
npm start -- dns <zoneId>
npm start -- request GET /zones
npm start -- request POST /zones/<id>/dns_records '{"type":"A","name":"a.example.com","content":"1.2.3.4","ttl":1}'
```

## Library

```js
import { Cloudflare } from './src/client.js';

const cf = new Cloudflare({ apiToken: process.env.CLOUDFLARE_API_TOKEN });
const zones = await cf.listZones();
const result = await cf.request('GET', '/zones/<id>/settings');
```

`request(method, path, { query, body })` works for any endpoint in the OpenAPI spec; `paginate(path)` collects all pages of list endpoints.

## Tests

```bash
npm test
```
