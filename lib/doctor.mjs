#!/usr/bin/env node
// Preflight: docker daemon, banadi container, in-container nmap, host disk.
// stderr: progress log. stdout: one JSON report. exit 0 on ok/warn, 1 on fail.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import { log } from './util/log.mjs';

const exec = promisify(execFile);

function firstLine(s) { return (s ?? '').toString().trim().split('\n')[0]; }
function execHint(r) { return firstLine(r.stderr) || firstLine(r.message); }

const env = {
  container: process.env.BANADI_CONTAINER ?? 'banadi',
  image: process.env.BANADI_IMAGE ?? 'banadi/banadi:latest',
};

async function runExec(file, args) {
  try {
    const { stdout, stderr } = await exec(file, args, { timeout: 15_000, windowsHide: true });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (e) {
    return {
      ok: false,
      code: e.code,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      message: e.message,
    };
  }
}

async function checkDocker() {
  const r = await runExec('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!r.ok) {
    return { name: 'docker', status: 'fail', detail: `docker daemon unreachable: ${execHint(r)}` };
  }
  return { name: 'docker', status: 'ok', detail: `server ${r.stdout.trim()}` };
}

async function checkImage() {
  const r = await runExec('docker', ['image', 'inspect', env.image, '--format', '{{.Id}}']);
  if (!r.ok) {
    return {
      name: 'banadi-image',
      status: 'fail',
      detail: `image "${env.image}" not built — run scripts/banadi-up.sh (or scripts/banadi-up.ps1 on Windows)`,
    };
  }
  return { name: 'banadi-image', status: 'ok', detail: env.image };
}

async function checkContainer() {
  const r = await runExec('docker', [
    'ps',
    '--filter', `name=^${env.container}$`,
    '--format', '{{.Names}}\t{{.Status}}',
  ]);
  if (!r.ok) {
    return { name: 'banadi-container', status: 'fail', detail: `docker ps failed: ${execHint(r)}` };
  }
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const match = lines.find((l) => l.split('\t')[0] === env.container);
  if (!match) {
    return {
      name: 'banadi-container',
      status: 'fail',
      detail: `container "${env.container}" not running — run scripts/banadi-up.sh (or scripts/banadi-up.ps1 on Windows)`,
    };
  }
  const [name, status] = match.split('\t');
  if (!/^Up\b/.test(status ?? '')) {
    return { name: 'banadi-container', status: 'fail', detail: `${name} not Up: ${status}` };
  }
  return { name: 'banadi-container', status: 'ok', detail: `${name} ${status}` };
}

async function checkNmap() {
  const r = await runExec('docker', ['exec', env.container, 'nmap', '--version']);
  if (!r.ok) {
    return {
      name: 'nmap',
      status: 'fail',
      detail: `nmap not available in ${env.container}: ${execHint(r)}`,
    };
  }
  return { name: 'nmap', status: 'ok', detail: firstLine(r.stdout) };
}

async function checkDisk() {
  try {
    const s = await statfs(process.cwd());
    const freeGb = (s.bsize * s.bavail) / 1024 ** 3;
    const status = freeGb < 2 ? 'warn' : 'ok';
    return { name: 'disk', status, detail: `${freeGb.toFixed(1)} GB free on project volume` };
  } catch (e) {
    return { name: 'disk', status: 'warn', detail: `statfs failed: ${e.message}` };
  }
}

async function main() {
  log.info('banadi doctor: running preflight checks');

  const docker = await checkDocker();
  let image, container, nmap;
  if (docker.status === 'ok') {
    image = await checkImage();
    container = image.status === 'ok' ? await checkContainer() : skip('banadi-container', 'image missing');
    nmap = container?.status === 'ok' ? await checkNmap() : skip('nmap', 'container not up');
  } else {
    image = skip('banadi-image', 'docker unreachable');
    container = skip('banadi-container', 'docker unreachable');
    nmap = skip('nmap', 'docker unreachable');
  }
  const disk = await checkDisk();

  const checks = [docker, image, container, nmap, disk];
  for (const c of checks) {
    const line = `${c.status.toUpperCase().padEnd(4)} ${c.name.padEnd(20)} ${c.detail}`;
    if (c.status === 'fail') log.error(line);
    else if (c.status === 'warn') log.warn(line);
    else log.info(line);
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const overall = fails > 0 ? 'fail' : warns > 0 ? 'warn' : 'ok';

  const report = { overall, checks, env, timestamp: new Date().toISOString() };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(overall === 'fail' ? 1 : 0);
}

function skip(name, reason) {
  return { name, status: 'fail', detail: `skipped: ${reason}` };
}

main().catch((e) => {
  log.error(`doctor crashed: ${e.stack ?? e}`);
  process.exit(1);
});
