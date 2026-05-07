#!/usr/bin/env node
// Engagement directory management.
//
// One engagement = one dir under engagements/<slug>/ with scope.yml,
// transcripts/, and (after a recon run) ports.yml.
// Slug = lowercased target with non-alnum → '-'. On collision the existing
// dir is reused if its scope.yml records the same target; otherwise a numeric
// suffix (-2, -3, …) is appended.

import { mkdir, writeFile, stat, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

const ENGAGEMENTS_DIR = process.env.ENGAGEMENTS_DIR ?? './engagements';

export function slugify(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error(`slugify: expected non-empty string, got ${typeof raw}`);
  }
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) throw new Error(`slugify: "${raw}" reduced to empty slug`);
  return s;
}

export function engagementsRoot(override) {
  return resolve(override ?? ENGAGEMENTS_DIR);
}

export async function exists(slug, opts = {}) {
  const root = engagementsRoot(opts.engagementsDir);
  const dir = join(root, slug);
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readTargetFromScope(dir) {
  try {
    const raw = await readFile(join(dir, 'scope.yml'), 'utf-8');
    const m = raw.match(/^# target:\s*(\S+)\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export async function resolveSlug(target, opts = {}) {
  const base = slugify(target);
  const root = engagementsRoot(opts.engagementsDir);
  if (!(await exists(base, opts))) return base;
  if (!opts.forceNew) {
    const existingTarget = await readTargetFromScope(join(root, base));
    if (existingTarget === target) return base;
  }
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate, opts))) return candidate;
    if (!opts.forceNew) {
      const t = await readTargetFromScope(join(root, candidate));
      if (t === target) return candidate;
    }
  }
  throw new Error(`resolveSlug: exhausted collision suffixes for base "${base}"`);
}

/**
 * Initialize a fresh engagement directory. Writes scope.yml (frozen snapshot)
 * and makes transcripts/. If a directory already exists for the same target
 * it is reused as-is. Returns { slug, dir, created }.
 */
export async function init(target, opts = {}) {
  const slug = opts.slug ?? (await resolveSlug(target, opts));
  const root = engagementsRoot(opts.engagementsDir);
  const dir = join(root, slug);

  if (await exists(slug, opts)) {
    return { slug, dir, created: false };
  }

  await mkdir(join(dir, 'transcripts'), { recursive: true });

  const scopeYml =
    `# engagement: ${slug}\n` +
    `# created: ${new Date().toISOString()}\n` +
    `# target: ${target}\n` +
    `targets:\n` +
    `  - value: ${target}\n` +
    `    authorization: personal lab — update before real runs\n`;
  await writeFile(join(dir, 'scope.yml'), scopeYml, 'utf-8');

  log.info(`engagement init slug=${slug} dir=${dir}`);
  return { slug, dir, created: true };
}

export async function load(slug, opts = {}) {
  if (!(await exists(slug, opts))) {
    throw new Error(`engagement "${slug}" not found under ${engagementsRoot(opts.engagementsDir)}`);
  }
  return { slug, dir: join(engagementsRoot(opts.engagementsDir), slug) };
}

export async function dirOf(slug, opts = {}) {
  const { dir } = await load(slug, opts);
  return dir;
}

export async function list(opts = {}) {
  const root = engagementsRoot(opts.engagementsDir);
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// ---------- CLI ----------

async function main() {
  const [, , cmd, arg] = process.argv;
  try {
    if (cmd === 'init') {
      if (!arg) { log.error('usage: node lib/engagement.mjs init <target>'); process.exit(2); }
      const r = await init(arg);
      process.stdout.write(JSON.stringify(r) + '\n');
      return;
    }
    if (cmd === 'list' || !cmd) {
      const xs = await list();
      process.stdout.write(xs.join('\n') + (xs.length ? '\n' : ''));
      return;
    }
    log.error(`unknown command "${cmd}"`);
    process.exit(2);
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
