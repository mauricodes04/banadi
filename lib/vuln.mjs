#!/usr/bin/env node
// Vuln-prep stage. Reads engagements/<slug>/ports.yml, fetches per-service
// hackviser pages into .cache/hackviser/<slug>.html (via in-container curl),
// classifies each port as one of:
//   - generate    : has a service mapping AND no pent/<port>.mjs yet
//   - exists      : pent/<port>.mjs already on disk (skipped unless --force)
//   - unmapped    : service not in lib/services.mjs (manual review)
//   - skip-svc    : service is tcpwrapped/unknown/empty
//
// Stdout: one JSON object describing the work to do. Claude Code reads it,
// Reads each cache file, synthesizes pent/<port>.mjs, Writes them. This
// module never produces .mjs content itself — that's the LLM's job.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execIn } from './exec.mjs';
import { dirOf } from './engagement.mjs';
import { lookupService } from './services.mjs';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

const PENT_DIR = process.env.PENT_DIR ?? './pent';
const CACHE_DIR = process.env.HACKVISER_CACHE_DIR ?? './.cache/hackviser';

function parsePortsYaml(text) {
  // Tiny parser matching the shape lib/recon.mjs writes. Each row is a
  // `- port:` line followed by `protocol/state/service/version` siblings.
  const ports = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const dash = line.match(/^\s*-\s+port:\s*(\d+)\s*$/);
    if (dash) {
      if (cur) ports.push(cur);
      cur = { port: Number(dash[1]) };
      continue;
    }
    const kv = line.match(/^\s+(protocol|state|service|version):\s*(.*)$/);
    if (kv && cur) {
      let v = kv[2].trim();
      if (v === '~' || v === '') v = null;
      else if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
      cur[kv[1]] = v;
    }
  }
  if (cur) ports.push(cur);
  return ports;
}

async function ensureCache(slug, url, opts) {
  await mkdir(resolve(CACHE_DIR), { recursive: true });
  const cachePath = join(resolve(CACHE_DIR), `${slug}.html`);
  if (existsSync(cachePath) && !opts.refresh) {
    return { cachePath, fetched: false };
  }
  // Fetch via in-container curl per CLAUDE.md invariant 1.
  const r = await execIn(['curl', '-fsSL', '--max-time', '30', url]);
  if (r.code !== 0) {
    throw new Error(`hackviser fetch failed (${url}): exit ${r.code}: ${r.stderr.trim().split('\n')[0]}`);
  }
  await writeFile(cachePath, r.stdout, 'utf-8');
  return { cachePath, fetched: true };
}

export async function prepare(slug, opts = {}) {
  const dir = await dirOf(slug);
  const portsText = await readFile(join(dir, 'ports.yml'), 'utf-8');
  const ports = parsePortsYaml(portsText);

  await mkdir(resolve(PENT_DIR), { recursive: true });

  const generate = [];
  const exists = [];
  const unmapped = [];
  const skipSvc = [];
  const autoMapped = [];
  const cacheTouched = new Set();

  for (const p of ports) {
    if (p.state && p.state !== 'open') continue;
    const targetPath = join(resolve(PENT_DIR), `${p.port}.mjs`);
    const targetExists = existsSync(targetPath);

    const lk = lookupService(p.service, p.port);

    if (lk.status === 'skip') {
      skipSvc.push({ port: p.port, service: p.service, reason: lk.reason });
      continue;
    }
    if (lk.status === 'unmapped') {
      unmapped.push({ port: p.port, service: p.service, reason: lk.reason });
      continue;
    }
    // status === 'ok'
    if (lk.via === 'catalog') {
      autoMapped.push({ port: p.port, service: p.service, slug: lk.slug, via: 'catalog' });
    } else if (lk.via === 'port-fallback') {
      autoMapped.push({ port: p.port, service: p.service, slug: lk.slug, via: 'port-fallback' });
    }
    if (targetExists && !opts.force) {
      exists.push({ port: p.port, service: p.service, slug: lk.slug, target_path: targetPath });
      continue;
    }

    let cache;
    try {
      cache = await ensureCache(lk.slug, lk.url, { refresh: opts.refresh });
    } catch (e) {
      // Fetch failure is per-service; record and continue.
      unmapped.push({ port: p.port, service: p.service, reason: `fetch failed: ${e.message}` });
      continue;
    }
    cacheTouched.add(cache.cachePath);

    generate.push({
      port: p.port,
      protocol: p.protocol ?? 'tcp',
      service: p.service,
      version: p.version ?? null,
      hackviser_slug: lk.slug,
      hackviser_url: lk.url,
      cache_path: cache.cachePath,
      target_path: targetPath,
      overwrite: targetExists,
    });
  }

  const ts = Math.floor(Date.now() / 1000);
  const transcript = {
    phase: 'vuln-prep',
    slug,
    timestamp: new Date().toISOString(),
    pent_dir: resolve(PENT_DIR),
    cache_dir: resolve(CACHE_DIR),
    cache_touched: [...cacheTouched],
    ports_total: ports.length,
    generate,
    exists,
    unmapped,
    skipped_service: skipSvc,
    auto_mapped: autoMapped,
    force: !!opts.force,
    refresh: !!opts.refresh,
  };
  const transcriptPath = join(dir, 'transcripts', `vuln-prep-${ts}.json`);
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf-8');

  return { ...transcript, transcript: transcriptPath };
}

// ---------- CLI ----------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    log.error('usage: node lib/vuln.mjs <slug> [--force] [--refresh]');
    process.exit(2);
  }
  const slug = argv[0];
  const opts = {
    force: argv.includes('--force'),
    refresh: argv.includes('--refresh'),
  };
  try {
    const r = await prepare(slug, opts);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } catch (e) {
    log.error(`vuln-prep: ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
