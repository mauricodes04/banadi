#!/usr/bin/env node
// Advisory scope matcher. Loads config/scope.yml (or scope.example.yml as a
// fallback), matches a target against entries. Warns on mismatch but never
// refuses — CLAUDE.md invariant 3.
//
// No YAML dependency: parser handles the tiny subset scope.yml uses
// (top-level list + per-entry `value:` + `authorization:`), which keeps this
// module dep-free.

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

const DEFAULT_PATH = process.env.SCOPE_FILE ?? './config/scope.yml';
const FALLBACK_PATH = './config/scope.example.yml';

function parseMiniYaml(text) {
  const entries = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const dashMatch = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    if (dashMatch) {
      if (cur) entries.push(cur);
      cur = { [dashMatch[1]]: dashMatch[2].trim() };
      continue;
    }
    const kvMatch = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (kvMatch && cur) {
      cur[kvMatch[1]] = kvMatch[2].trim();
    }
  }
  if (cur) entries.push(cur);
  return entries.filter((e) => e.value);
}

async function resolvePath(opts) {
  if (opts?.path) return resolve(opts.path);
  try {
    await stat(DEFAULT_PATH);
    return resolve(DEFAULT_PATH);
  } catch {
    return resolve(FALLBACK_PATH);
  }
}

export async function loadScope(opts = {}) {
  const path = await resolvePath(opts);
  const text = await readFile(path, 'utf-8').catch((e) => {
    throw new Error(`scope: failed to read ${path}: ${e.message}`);
  });
  return { path, entries: parseMiniYaml(text) };
}

function ipToInt(ip) {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchesCidr(ip, cidr) {
  const [net, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipToInt(ip);
  const b = ipToInt(net);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

function matchesHost(target, value) {
  if (target === value) return true;
  return target.endsWith(`.${value}`);
}

export function matchEntry(target, entry) {
  const v = entry.value;
  if (!v) return false;
  if (v.includes('/')) return matchesCidr(target, v);
  if (ipToInt(v) !== null) return target === v;
  return matchesHost(target, v);
}

/**
 * Match a target against scope. Warns on mismatch (advisory); never throws
 * for out-of-scope targets. Throws only on scope-file read failure.
 */
export async function match(target, opts = {}) {
  if (!target) throw new Error('scope.match: target is required');
  const { path, entries } = await loadScope(opts);
  for (const entry of entries) {
    if (matchEntry(target, entry)) {
      return { matched: true, entry, scope_path: path };
    }
  }
  log.warn(`scope: target "${target}" is out of scope per ${path} — proceeding anyway (advisory)`);
  return { matched: false, entry: null, scope_path: path };
}

// ---------- CLI ----------

async function main() {
  const [, , target] = process.argv;
  try {
    if (!target) {
      const { path, entries } = await loadScope();
      process.stdout.write(JSON.stringify({ path, entries }, null, 2) + '\n');
      return;
    }
    const result = await match(target);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    // Out-of-scope is advisory (CLAUDE.md invariant 3); always exit 0 from here.
  } catch (e) {
    log.error(`scope: ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
