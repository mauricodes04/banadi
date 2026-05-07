#!/usr/bin/env node
// Refresh the hackviser service-slug catalog.
//
// Fetches https://hackviser.com/tactics/pentesting via in-container curl
// (per CLAUDE.md invariant 1), extracts every /tactics/pentesting/services/<slug>
// link, and persists the sorted, deduped list to lib/services.catalog.json.
//
// Re-run when hackviser publishes a new service page. lib/services.mjs auto-maps
// any nmap service whose normalized name appears in this catalog.

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execIn } from '../lib/exec.mjs';
import { log } from '../lib/util/log.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, '..', 'lib', 'services.catalog.json');
const INDEX_URL = 'https://hackviser.com/tactics/pentesting';
const SLUG_RE = /\/tactics\/pentesting\/services\/([a-z0-9-]+)/g;

async function main() {
  log.info(`fetching ${INDEX_URL}`);
  const r = await execIn(['curl', '-fsSL', '--max-time', '30', INDEX_URL]);
  if (r.code !== 0) {
    log.error(`fetch failed: exit ${r.code}: ${r.stderr.trim().split('\n')[0] || 'no stderr'}`);
    process.exit(1);
  }
  const slugs = [...new Set([...r.stdout.matchAll(SLUG_RE)].map((m) => m[1]))].sort();
  if (slugs.length === 0) {
    log.error('no slugs extracted; hackviser layout may have changed');
    process.exit(1);
  }
  const catalog = {
    source: INDEX_URL,
    fetched_at: new Date().toISOString(),
    slug_count: slugs.length,
    slugs,
  };
  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  log.info(`wrote ${CATALOG_PATH} (${slugs.length} slugs)`);
}

main().catch((e) => {
  log.error(e.message);
  process.exit(1);
});
