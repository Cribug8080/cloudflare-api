const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors ?? [];
  }
}

/** Retry-After (seconds or HTTP date) if present, else exponential backoff (1s, 2s, 4s... max 60s) + jitter. */
function retryDelayMs(retryAfter, attempt) {
  let ms = NaN;
  if (retryAfter) {
    ms = /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  }
  if (!Number.isFinite(ms) || ms < 0) ms = Math.min(1000 * 2 ** attempt, 60_000);
  return Math.min(ms, 120_000) + Math.random() * 250;
}

export class Cloudflare {
  /**
   * @param {object} opts
   * @param {string} [opts.apiToken]  Scoped API token (recommended)
   * @param {string} [opts.email]     Legacy: account email (with apiKey)
   * @param {string} [opts.apiKey]    Legacy: Global API key
   * @param {string} [opts.baseUrl]
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({
    apiToken, email, apiKey, baseUrl = BASE_URL, fetch: fetchImpl = fetch,
    maxRetries = 6, onRetry, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    if (!apiToken && !(email && apiKey)) {
      throw new Error('Provide apiToken, or email + apiKey');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.maxRetries = maxRetries;
    this.onRetry = onRetry;
    this.sleep = sleep;
    this.headers = apiToken
      ? { Authorization: `Bearer ${apiToken}` }
      : { 'X-Auth-Email': email, 'X-Auth-Key': apiKey };
  }

  /** Low-level request. Returns the `result` field of the Cloudflare envelope. */
  async request(method, path, { query, body } = {}) {
    const { result } = await this.#send(method, path, { query, body });
    return result;
  }

  /** Auto-paginates list endpoints (page/per_page) and returns all items. */
  async paginate(path, query = {}) {
    const all = [];
    for (let page = 1; ; page++) {
      const { result, result_info: info } = await this.#send('GET', path, {
        query: { per_page: 50, ...query, page },
      });
      all.push(...result);
      if (!info || page >= info.total_pages) return all;
    }
  }

  async #send(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    let res;
    for (let attempt = 0; ; attempt++) {
      res = await this.fetch(url, {
        method: method.toUpperCase(),
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // Rate limited (or transient 5xx): wait, then retry.
      if ((res.status !== 429 && res.status < 502) || attempt >= this.maxRetries) break;
      const wait = retryDelayMs(res.headers.get('retry-after'), attempt);
      this.onRetry?.({ status: res.status, attempt: attempt + 1, waitMs: wait });
      await this.sleep(wait);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new CloudflareError(`HTTP ${res.status}: non-JSON response`, { status: res.status });
    }

    if (!res.ok || data.success === false) {
      const errors = data.errors ?? [];
      const msg = errors.map((e) => `[${e.code}] ${e.message}`).join('; ') || `HTTP ${res.status}`;
      throw new CloudflareError(msg, { status: res.status, errors });
    }
    return data;
  }

  // ---- Convenience helpers ----
  verifyToken() { return this.request('GET', '/user/tokens/verify'); }
  listZones(query) { return this.paginate('/zones', query); }
  listDnsRecords(zoneId, query) { return this.paginate(`/zones/${zoneId}/dns_records`, query); }
  createDnsRecord(zoneId, record) { return this.request('POST', `/zones/${zoneId}/dns_records`, { body: record }); }
  deleteDnsRecord(zoneId, id) { return this.request('DELETE', `/zones/${zoneId}/dns_records/${id}`); }
  listAccounts() { return this.paginate('/accounts'); }

  /** One domain-check request (the API accepts a limited number of domains per call). */
  checkDomainsOnce(accountId, domains) {
    return this.request('POST', `/accounts/${accountId}/registrar/domain-check`, { body: { domains } });
  }

  /**
   * Checks any number of domains, sending `batchSize` (default 20) per request.
   * Calls `onBatch({ index, total, domains, result })` after each request.
   * Returns the per-batch results in order.
   */
  async checkDomains(accountId, domains, { batchSize = 20, delayMs = 0, onBatch } = {}) {
    const total = Math.ceil(domains.length / batchSize);
    const results = [];
    for (let i = 0; i < total; i++) {
      if (i > 0 && delayMs > 0) await this.sleep(delayMs);
      const batch = domains.slice(i * batchSize, (i + 1) * batchSize);
      const result = await this.checkDomainsOnce(accountId, batch);
      results.push(result);
      onBatch?.({ index: i + 1, total, domains: batch, result });
    }
    return results;
  }
}
