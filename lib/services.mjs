// Map nmap service names → hackviser pentesting-tactics slug.
//
// Three-tier lookup:
//   1. Normalize the nmap service name (lowercase, strip trailing '?'), then
//      match against SERVICE_ALIASES (curated; handles cases where nmap's
//      service string differs from hackviser's slug, e.g. microsoft-ds → smb).
//   2. If that misses, try PORT_FALLBACK — nmap often mislabels well-known
//      ports (e.g. port 9200 reported as "wap-wsp?" instead of elasticsearch).
//   3. If that misses, check the hackviser slug catalog at services.catalog.json
//      (refreshed by scripts/refresh-services-catalog.mjs). When the normalized
//      service name itself is a published hackviser slug, auto-map it and flag
//      the lookup with via='catalog' so callers can surface the discovery.
//
// To add a curated alias: add a row to SERVICES. To add a port fallback: add to
// PORT_FALLBACK. To pick up newly published hackviser pages: re-run
// `node scripts/refresh-services-catalog.mjs`.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, 'services.catalog.json');

const HACKVISER_BASE = 'https://hackviser.com/tactics/pentesting/services';

// Curated alias rows. Use these when one nmap service name maps to a slug it
// doesn't textually match, or when several nmap labels collapse to one slug.
// Keep aliases lowercased; lookups are case-insensitive.
const SERVICES = [
  { slug: 'ssh',           aliases: ['ssh'] },
  { slug: 'ftp',           aliases: ['ftp', 'ftps', 'ftp-data', 'ssl/ftp'] },
  { slug: 'http',          aliases: ['http', 'http-proxy', 'http-alt', 'https', 'https-alt', 'ssl/http', 'ssl/https'] },
  { slug: 'imap',          aliases: ['imap', 'imaps', 'ssl/imap'] },
  { slug: 'smb',           aliases: ['microsoft-ds', 'netbios-ssn', 'netbios-ns', 'netbios-dgm', 'smb'] },
  { slug: 'msrpc',         aliases: ['msrpc', 'rpcbind'] },
  { slug: 'elasticsearch', aliases: ['elasticsearch'] },
];

// Port-based fallback for when nmap mislabels a well-known port.
const PORT_FALLBACK = {
  9200: 'elasticsearch',
  9300: 'elasticsearch',
  5601: 'elasticsearch',  // Kibana — no dedicated page; elasticsearch page covers it
};

// Service strings that explicitly mean "we couldn't identify this" — skip
// without surfacing as a missing-mapping warning.
const NON_SERVICES = new Set(['tcpwrapped', 'unknown', '']);

function loadCatalog() {
  if (!existsSync(CATALOG_PATH)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
    return new Set(Array.isArray(raw.slugs) ? raw.slugs : []);
  } catch {
    return new Set();
  }
}

const CATALOG = loadCatalog();

/**
 * Look up a hackviser slug for a given nmap service name + port number.
 * Returns one of:
 *   { status: 'ok', slug, url, via? }   — via is 'port-fallback' or 'catalog' when not a curated alias
 *   { status: 'skip', reason }          — service is tcpwrapped/unknown/empty
 *   { status: 'unmapped', reason }      — no mapping found in any tier
 */
export function lookupService(serviceName, port) {
  // Normalize: strip trailing '?' (nmap uncertainty marker) and lowercase.
  const key = serviceName == null ? '' : String(serviceName).trim().toLowerCase().replace(/\?+$/, '');

  if (NON_SERVICES.has(key)) {
    return { status: 'skip', reason: `service is "${String(serviceName).trim()}"` };
  }

  // Tier 1: curated alias match.
  if (key) {
    for (const row of SERVICES) {
      if (row.aliases.includes(key)) {
        return { status: 'ok', slug: row.slug, url: `${HACKVISER_BASE}/${row.slug}` };
      }
    }
  }

  // Tier 2: port-number fallback.
  const portNum = Number(port);
  if (!Number.isNaN(portNum) && PORT_FALLBACK[portNum]) {
    const slug = PORT_FALLBACK[portNum];
    return { status: 'ok', slug, url: `${HACKVISER_BASE}/${slug}`, via: 'port-fallback' };
  }

  // Tier 3: catalog auto-match — service name itself is a published hackviser slug.
  if (key && CATALOG.has(key)) {
    return { status: 'ok', slug: key, url: `${HACKVISER_BASE}/${key}`, via: 'catalog' };
  }

  const label = key || String(serviceName);
  return { status: 'unmapped', reason: `no hackviser mapping for service "${label}" on port ${port}` };
}

export function listKnownSlugs() {
  return [...new Set([...SERVICES.map((r) => r.slug), ...CATALOG])].sort();
}

export function catalogSize() {
  return CATALOG.size;
}
