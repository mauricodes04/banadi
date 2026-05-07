#!/usr/bin/env node
// CVE prep stage. Reads engagements/<slug>/ports.yml + os.yml, classifies
// each open port as generate/exists/skip, and produces a work-item JSON for
// Claude Code to act on.
//
// Claude Code then:
//   1. Reads each port's pent/<port>.mjs for the version banner.
//   2. Uses LLM knowledge to name candidate CVE IDs for that version + OS.
//   3. Curls the NVD API (inside the banadi container) to verify each ID.
//   4. Writes pent/<port>.cve.json with the confirmed results.
//
// This module never does the CVE lookup itself — that's the LLM + curl step.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { dirOf } from './engagement.mjs';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

const PENT_DIR = process.env.PENT_DIR ?? './pent';

function parsePortsYaml(text) {
  const ports = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const dash = line.match(/^\s*-\s+port:\s*(\d+)\s*$/);
    if (dash) { if (cur) ports.push(cur); cur = { port: Number(dash[1]) }; continue; }
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

function parseOsYaml(text) {
  const os = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line.startsWith('#') || !line) continue;
    if (line === 'os:') continue;
    if (line.startsWith('~')) return null;  // null/failed detection
    const kv = line.match(/^(name|family|accuracy|cpe):\s*(.+)$/);
    if (kv) {
      let v = kv[2].trim();
      if (v === '~') v = null;
      else if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
      else if (kv[1] === 'accuracy') v = Number(v) || null;
      os[kv[1]] = v;
    }
  }
  return Object.keys(os).length ? os : null;
}

export async function prepare(slug, opts = {}) {
  const dir = await dirOf(slug);

  const portsText = await readFile(join(dir, 'ports.yml'), 'utf-8');
  const ports = parsePortsYaml(portsText);

  let os = null;
  try {
    const osText = await readFile(join(dir, 'os.yml'), 'utf-8');
    os = parseOsYaml(osText);
  } catch {
    log.warn(`cve-prep: os.yml not found for ${slug} — run /banadi-recon again to generate it`);
  }

  await mkdir(resolve(PENT_DIR), { recursive: true });

  const generate = [], exists = [], skipped = [];

  for (const p of ports) {
    if (p.state && p.state !== 'open') continue;
    const pentPath = join(resolve(PENT_DIR), `${p.port}.mjs`);
    const cvePath  = join(resolve(PENT_DIR), `${p.port}.cve.json`);

    if (!existsSync(pentPath)) {
      skipped.push({ port: p.port, service: p.service, reason: `pent/${p.port}.mjs not yet generated — run /banadi-vuln first` });
      continue;
    }

    if (existsSync(cvePath) && !opts.force) {
      exists.push({ port: p.port, service: p.service, version: p.version, cve_path: cvePath });
      continue;
    }

    generate.push({
      port: p.port,
      protocol: p.protocol ?? 'tcp',
      service: p.service,
      version: p.version ?? null,
      os: os?.name ?? null,
      os_family: os?.family ?? null,
      pent_path: pentPath,
      cve_path: cvePath,
      overwrite: existsSync(cvePath),
    });
  }

  const ts = Math.floor(Date.now() / 1000);
  const transcript = {
    phase: 'cve-prep',
    slug,
    timestamp: new Date().toISOString(),
    pent_dir: resolve(PENT_DIR),
    os,
    ports_total: ports.length,
    generate,
    exists,
    skipped,
    force: !!opts.force,
  };
  const transcriptPath = join(dir, 'transcripts', `cve-prep-${ts}.json`);
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf-8');

  return { ...transcript, transcript: transcriptPath };
}

// ---------- CLI ----------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    log.error('usage: node lib/cve.mjs <slug> [--force]');
    process.exit(2);
  }
  const slug = argv[0];
  const opts = { force: argv.includes('--force') };
  try {
    const r = await prepare(slug, opts);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } catch (e) {
    log.error(`cve-prep: ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
