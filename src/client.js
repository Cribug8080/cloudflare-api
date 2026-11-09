const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors ?? [];
  }
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
  constructor({ apiToken, email, apiKey, baseUrl = BASE_URL, fetch: fetchImpl = fetch } = {}) {
    if (!apiToken && !(email && apiKey)) {
      throw new Error('Provide apiToken, or email + apiKey');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
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

    const res = await this.fetch(url, {
      method: method.toUpperCase(),
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

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
}
