#!/usr/bin/env node
// Patch (host introspection): enumerate Windows-installed programs from the
// registry uninstall keys via PowerShell, write the CSV under
// engagements/<hostname>/patches/<unix_ts>/installed_programs.csv, write a
// JSON transcript. The LLM triages the CSV in a follow-up step.
//
// Unlike recon/vuln/cve, this does NOT route through the banadi container —
// the registry lives on the host and PowerShell is Windows-only.
//
// Output JSON on stdout: { slug, dir, run_dir, csv_path, report_path,
// transcript_path, hostname, program_count, ps_argv, exit_code, wall_ms }.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { hostname, platform } from 'node:os';
import { join, relative } from 'node:path';
import { slugify, engagementsRoot } from './engagement.mjs';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

// Mirrors planroom/powershell line, but writes to a path passed in as $env:BANADI_PATCH_CSV
// instead of $env:USERPROFILE\Desktop\installed_programs.csv so the file lands in
// the engagement directory.
const PS_SCRIPT = `
Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,
                 HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* |
Select-Object DisplayName, Publisher, InstallDate, DisplayVersion |
Where-Object { $_.DisplayName } |
Sort-Object DisplayName |
Export-Csv $env:BANADI_PATCH_CSV -NoTypeInformation -Encoding UTF8
`.trim();

function runPowershell(csvPath) {
  const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT];
  return new Promise((resolveP) => {
    const start = Date.now();
    const proc = spawn(argv[0], argv.slice(1), {
      env: { ...process.env, BANADI_PATCH_CSV: csvPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString('utf-8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf-8'); });
    proc.on('error', (e) => {
      resolveP({ argv, code: -1, wallMs: Date.now() - start, stdout, stderr: stderr + `\n${e.message}` });
    });
    proc.on('close', (code) => {
      resolveP({ argv, code: code ?? -1, wallMs: Date.now() - start, stdout, stderr });
    });
  });
}

async function countCsvRows(csvPath) {
  try {
    const raw = await readFile(csvPath, 'utf-8');
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
}

export async function patch(opts = {}) {
  if (platform() !== 'win32') {
    throw new Error(`patch: Windows-only (current platform: ${platform()})`);
  }

  const slug = opts.slug ?? slugify(hostname());
  const root = engagementsRoot(opts.engagementsDir);
  const dir = join(root, slug);
  const ts = Math.floor(Date.now() / 1000);
  const timestamp = new Date().toISOString();
  const runDir = join(dir, 'patches', String(ts));
  const transcriptDir = join(dir, 'transcripts');

  await mkdir(runDir, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  const csvPath = join(runDir, 'installed_programs.csv');
  const reportPath = join(runDir, 'report.md');
  const transcriptPath = join(transcriptDir, `patch-${ts}.json`);

  log.info(`patch: enumerating installed programs → ${relative(process.cwd(), csvPath)}`);
  const ps = await runPowershell(csvPath);

  const programCount = ps.code === 0 ? await countCsvRows(csvPath) : 0;

  const transcript = {
    phase: 'patch',
    slug, hostname: hostname(), timestamp,
    powershell: {
      argv: ps.argv,
      script: PS_SCRIPT,
      env: { BANADI_PATCH_CSV: csvPath },
      exit_code: ps.code,
      wall_ms: ps.wallMs,
      stdout: ps.stdout,
      stderr: ps.stderr,
    },
    csv_path: csvPath,
    report_path: reportPath,
    program_count: programCount,
  };
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf-8');

  return {
    slug, dir, run_dir: runDir,
    csv_path: csvPath,
    report_path: reportPath,
    transcript_path: transcriptPath,
    hostname: hostname(),
    program_count: programCount,
    ps_argv: ps.argv,
    exit_code: ps.code,
    wall_ms: ps.wallMs,
  };
}

// ---------- CLI ----------

async function main() {
  try {
    const r = await patch();
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.exit_code === 0 ? 0 : 1);
  } catch (e) {
    log.error(`patch: ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
