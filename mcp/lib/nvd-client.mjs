// NVD HTTP client. Caches every response under .cache/nvd/.
// Network calls go through the banadi container (docker exec + curl via lib/exec.mjs)
// so the host file system never holds the response body during transit.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execIn } from '../../lib/exec.mjs';
import { log } from '../../lib/util/log.mjs';
import { TokenBucket } from './rate-limit.mjs';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const USER_AGENT = 'banadi/0.2.0 (+mcp)';
const CACHE_DIR = resolve(process.env.NVD_CACHE_DIR ?? './.cache/nvd');
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

const RETRY_BACKOFF_MS = [15000, 30000, 60000];
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

export const bucket = new TokenBucket();

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const cachePathForId = (id) => join(CACHE_DIR, `${id}.json`);
const cachePathForSearch = (key) => join(CACHE_DIR, 'search', `${sha1(key)}.json`);

async function ensureDir(path) {
  if (!existsSync(path)) await mkdir(path, { recursive: true });
}

async function readJsonIfFresh(path, ttlMs) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    const wrapper = JSON.parse(raw);
    if (ttlMs && wrapper._fetched_at) {
      if (Date.now() - Date.parse(wrapper._fetched_at) > ttlMs) return null;
    }
    return wrapper;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function curlOnce(url, container) {
  const argv = [
    'curl', '-sS', '--max-time', '30',
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', 'Accept: application/json',
    '-w', '\n__HTTP__:%{http_code}',
    url,
  ];
  const r = await execIn(argv, container ? { container } : {});
  const m = r.stdout.match(/\n__HTTP__:(\d+)\s*$/);
  const httpCode = m ? Number(m[1]) : 0;
  const body = m ? r.stdout.slice(0, r.stdout.length - m[0].length) : r.stdout;
  return { httpCode, body, exitCode: r.code, stderr: r.stderr, wallMs: r.wallMs };
}

async function fetchWithRetry(url, container) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    await bucket.acquire();
    try {
      const r = await curlOnce(url, container);
      if (r.exitCode === 0 && r.httpCode === 200) {
        return JSON.parse(r.body);
      }
      lastError = `http ${r.httpCode} exit ${r.exitCode}: ${r.stderr.trim() || r.body.slice(0, 120)}`;
      if (r.exitCode !== 0 || RETRYABLE_HTTP.has(r.httpCode)) {
        if (attempt < RETRY_BACKOFF_MS.length) {
          const wait = RETRY_BACKOFF_MS[attempt];
          log.warn(`nvd retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} in ${wait}ms (${lastError})`);
          await delay(wait);
          continue;
        }
      }
      throw new Error(lastError);
    } catch (e) {
      lastError = e.message;
      if (attempt >= RETRY_BACKOFF_MS.length) break;
      const wait = RETRY_BACKOFF_MS[attempt];
      log.warn(`nvd retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} in ${wait}ms (${lastError})`);
      await delay(wait);
    }
  }
  const err = new Error(`nvd_unavailable: ${lastError}`);
  err.code = 'NVD_UNAVAILABLE';
  err.attempts = RETRY_BACKOFF_MS.length + 1;
  throw err;
}

export async function fetchCve(id, { container } = {}) {
  await ensureDir(CACHE_DIR);
  const path = cachePathForId(id);
  const cached = await readJsonIfFresh(path);
  if (cached?.id) {
    return { ...cached, _cached: true, _fetched_at: cached._fetched_at ?? null };
  }
  const url = `${NVD_BASE}?cveId=${encodeURIComponent(id)}`;
  const json = await fetchWithRetry(url, container);
  const cve = json?.vulnerabilities?.[0]?.cve;
  if (!cve?.id) {
    const err = new Error(`nvd_not_found: ${id}`);
    err.code = 'NVD_NOT_FOUND';
    throw err;
  }
  const wrapper = { ...cve, _cached: false, _fetched_at: new Date().toISOString() };
  await writeFile(path, JSON.stringify(wrapper, null, 2) + '\n', 'utf-8');
  return wrapper;
}

function trimItems(json) {
  const items = (json.vulnerabilities ?? []).map((entry) => {
    const cve = entry.cve;
    const desc = cve.descriptions?.find((d) => d.lang === 'en')?.value ?? null;
    const v3 = cve.metrics?.cvssMetricV31?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData;
    return {
      id: cve.id,
      summary: desc,
      cvss: v3?.baseScore ?? cve.metrics?.cvssMetricV2?.[0]?.cvssData?.baseScore ?? null,
      published: cve.published ?? null,
    };
  });
  return { total: json.totalResults ?? items.length, items };
}

export async function searchByCpe(cpe, version, { container } = {}) {
  await ensureDir(join(CACHE_DIR, 'search'));
  const cacheKey = `cpe|${cpe}|${version ?? ''}`;
  const path = cachePathForSearch(cacheKey);
  const cached = await readJsonIfFresh(path, SEARCH_TTL_MS);
  if (cached) return { ...cached, _cached: true };
  const params = new URLSearchParams({ cpeName: cpe });
  if (version) params.set('versionStart', version);
  const url = `${NVD_BASE}?${params.toString()}`;
  const json = await fetchWithRetry(url, container);
  const trimmed = trimItems(json);
  const wrapper = { ...trimmed, _cached: false, _fetched_at: new Date().toISOString() };
  await writeFile(path, JSON.stringify(wrapper, null, 2) + '\n', 'utf-8');
  return wrapper;
}

export async function searchByKeyword(service, version, os, { container } = {}) {
  await ensureDir(join(CACHE_DIR, 'search'));
  const cacheKey = `kw|${service}|${version}|${os ?? ''}`;
  const path = cachePathForSearch(cacheKey);
  const cached = await readJsonIfFresh(path, SEARCH_TTL_MS);
  if (cached) return { ...cached, _cached: true };
  const params = new URLSearchParams({ keywordSearch: `${service} ${version}` });
  const url = `${NVD_BASE}?${params.toString()}`;
  const json = await fetchWithRetry(url, container);
  let trimmed = trimItems(json);
  if (os) {
    const needle = os.toLowerCase();
    trimmed = {
      total: trimmed.items.filter((i) => (i.summary ?? '').toLowerCase().includes(needle)).length,
      items: trimmed.items.filter((i) => (i.summary ?? '').toLowerCase().includes(needle)),
    };
  }
  const wrapper = { ...trimmed, _cached: false, _fetched_at: new Date().toISOString() };
  await writeFile(path, JSON.stringify(wrapper, null, 2) + '\n', 'utf-8');
  return wrapper;
}
