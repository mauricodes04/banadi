#!/usr/bin/env node
// Recon: run nmap -sV inside the banadi container against a target,
// parse the result into ports.yml, write a JSON transcript.
// Also attempts a secondary nmap -O OS-detection scan and writes os.yml.
// The -O scan is non-blocking: failure warns to stderr but does not fail recon.
//
// Output JSON on stdout: { slug, dir, ports_file, os_file, transcript, ports,
// os, target, nmap_argv, exit_code, wall_ms }.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execIn } from './exec.mjs';
import { init as engagementInit } from './engagement.mjs';
import { match as scopeMatch } from './scope.mjs';
import { log } from './util/log.mjs';
import { isMain } from './util/main.mjs';

const NMAP_BASE_ARGS = ['-sV', '-Pn', '--open'];

/**
 * Parse `nmap -sV` line-mode output. Returns an array of
 * { port: number, protocol: 'tcp'|'udp', state, service, version }.
 */
export function parseNmap(stdout) {
  const ports = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^(\d+)\/(tcp|udp)\s+(\S+)\s+(\S+)(?:\s+(.+))?$/);
    if (!m) continue;
    const [, port, protocol, state, service, version] = m;
    ports.push({
      port: Number(port),
      protocol,
      state,
      service,
      version: (version ?? '').trim() || null,
    });
  }
  return ports;
}

/**
 * Parse `nmap -A` / `-O` output. Returns { name, family, accuracy, cpe } or null.
 *
 * Source priority (highest first):
 *   1. smb-os-discovery `| OS:` line — direct from SMB banner (SMBv1 hosts).
 *   2. `Service Info: OS: …; CPE: …` — derived from -sV banners across
 *      multiple services; very reliable on hosts that expose any OS-tagged
 *      service (HTTP Server header, SMB negotiation, SSH banner, etc.).
 *   3. `OS details:` — confident -O match.
 *   4. `Aggressive OS guesses:` — top -O guess (often the only output when
 *      -O has insufficient port data).
 */
export function parseNmapOs(stdout) {
  let osName = null, osAcc = null, osCpe = null;
  let aggName = null, aggAcc = null;
  let smbName = null, smbCpe = null;
  let svcName = null, svcCpe = null;
  let topCpe = null;

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();

    const mSmbOs = line.match(/^\|\s*OS:\s*(.+?)(?:\s*\(.*\))?$/);
    if (mSmbOs && !smbName) { smbName = mSmbOs[1].trim(); continue; }
    const mSmbCpe = line.match(/^\|\s*OS CPE:\s*(\S+)/);
    if (mSmbCpe && !smbCpe) { smbCpe = mSmbCpe[1].trim(); continue; }

    const mSvc = line.match(/^Service Info:\s*(.+)$/);
    if (mSvc && !svcName) {
      const blob = mSvc[1];
      const m1 = blob.match(/OS:\s*([^;]+)/);
      const m2 = blob.match(/CPE:\s*(\S+)/);
      if (m1) svcName = m1[1].trim();
      if (m2) svcCpe = m2[1].trim().replace(/,$/, '');
      continue;
    }

    const mDetails = line.match(/^OS details:\s*(.+)$/);
    if (mDetails && !osName) { osName = mDetails[1].trim(); continue; }
    const mGuess = line.match(/^Aggressive OS guesses:\s*(.+?)\s*\((\d+)%\)/);
    if (mGuess && !aggName) { aggName = mGuess[1].trim(); aggAcc = Number(mGuess[2]); continue; }
    const mTopCpe = line.match(/^OS CPE:\s*(.+)$/);
    if (mTopCpe && !topCpe) { topCpe = mTopCpe[1].trim().split(' ')[0]; continue; }
  }

  let name = null, accuracy = null, cpe = null;
  if (smbName) { name = smbName; cpe = smbCpe; accuracy = 100; }
  else if (svcName) { name = svcName; cpe = svcCpe; accuracy = 95; }
  else if (osName) { name = osName; cpe = topCpe; accuracy = osAcc ?? 100; }
  else if (aggName) { name = aggName; cpe = topCpe; accuracy = aggAcc; }
  if (!name) return null;

  let family = 'Other';
  if (/windows/i.test(name)) family = 'Windows';
  else if (/linux|ubuntu|debian|centos|fedora|kali/i.test(name)) family = 'Linux';
  else if (/darwin|macos|os x/i.test(name)) family = 'macOS';
  else if (/freebsd|openbsd|netbsd/i.test(name)) family = 'BSD';
  return { name, family, accuracy, cpe };
}

function portsToYaml(target, ports, meta) {
  const lines = [
    `# target: ${target}`,
    `# scanned: ${meta.timestamp}`,
    `# nmap: ${meta.argv.join(' ')}`,
    `# exit_code: ${meta.code}`,
    `ports:`,
  ];
  if (ports.length === 0) {
    lines.push('  []');
  } else {
    for (const p of ports) {
      lines.push(`  - port: ${p.port}`);
      lines.push(`    protocol: ${p.protocol}`);
      lines.push(`    state: ${p.state}`);
      lines.push(`    service: ${p.service}`);
      lines.push(`    version: ${p.version === null ? '~' : JSON.stringify(p.version)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function osToYaml(target, os, meta) {
  const lines = [
    `# target: ${target}`,
    `# scanned: ${meta.timestamp}`,
    `# nmap: ${meta.argv.join(' ')}`,
    `# exit_code: ${meta.code}`,
    `os:`,
  ];
  if (!os) {
    lines.push(`  ~  # detection failed or inconclusive (${meta.reason ?? 'no OS match'})`);
  } else {
    lines.push(`  name: ${JSON.stringify(os.name)}`);
    lines.push(`  family: ${JSON.stringify(os.family)}`);
    lines.push(`  accuracy: ${os.accuracy ?? '~'}`);
    lines.push(`  cpe: ${os.cpe ? JSON.stringify(os.cpe) : '~'}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * End-to-end recon: ensures engagement, runs nmap -sV, then nmap -A
 * (aggressive: -O + -sV + -sC + traceroute) scoped to the open ports
 * discovered in the first pass. Writes ports.yml, os.yml, and a JSON
 * transcript. Returns the summary object.
 */
export async function recon(target, opts = {}) {
  if (!target) throw new Error('recon: target is required');

  await scopeMatch(target).catch((e) => log.warn(`scope: ${e.message}`));

  const { slug, dir, created } = await engagementInit(target);
  if (created) log.info(`engagement created: ${slug}`);

  // Primary scan: service version detection.
  const svArgs = [...NMAP_BASE_ARGS, ...(opts.extraArgs ?? []), target];
  const svArgv = ['nmap', ...svArgs];
  log.info(`nmap sV: ${svArgv.join(' ')}`);
  const svResult = await execIn(svArgv);
  const ports = parseNmap(svResult.stdout);

  // Secondary scan: aggressive OS + script detection (non-blocking, may require root).
  // -A bundles -O, -sV, -sC, and --traceroute, which correlates packet-level
  // fingerprinting with default-script banner data. We deliberately do NOT
  // restrict with -p here: nmap's -O needs at least one open AND one closed
  // port to fingerprint reliably, and scoping to open ports only collapses
  // accuracy. When SMB ports are open we additionally request
  // smb-os-discovery (covers SMBv1) and smb-protocols (covers SMB 2+).
  const smbPorts = ports.filter((p) => p.state === 'open' && (p.port === 139 || p.port === 445)).map((p) => p.port);
  const osArgs = ['-A', '-Pn', '--osscan-guess'];
  if (smbPorts.length) {
    osArgs.push('--script', 'default,smb-os-discovery,smb-protocols');
  }
  const osArgv = ['nmap', ...osArgs, target];
  log.info(`nmap OS: ${osArgv.join(' ')}`);
  let osResult, os, osReason;
  try {
    osResult = await execIn(osArgv);
    os = parseNmapOs(osResult.stdout);
    if (!os) osReason = 'nmap ran but no OS match found (host may block probes)';
  } catch (e) {
    osResult = { code: -1, stdout: '', stderr: e.message, argv: osArgv, wallMs: 0 };
    os = null;
    osReason = e.message;
    log.warn(`os-detect: ${e.message}`);
  }
  if (osResult.code !== 0 && !os) {
    osReason = osReason ?? `nmap -O exited ${osResult.code}`;
    log.warn(`os-detect: ${osReason}`);
  }

  const ts = Math.floor(Date.now() / 1000);
  const timestamp = new Date().toISOString();

  const transcript = {
    phase: 'recon',
    target, slug, timestamp,
    service_scan: {
      argv: svResult.argv,
      exit_code: svResult.code,
      wall_ms: svResult.wallMs,
      stdout: svResult.stdout,
      stderr: svResult.stderr,
    },
    os_scan: {
      argv: osResult?.argv ?? osArgv,
      exit_code: osResult?.code ?? -1,
      wall_ms: osResult?.wallMs ?? 0,
      stdout: osResult?.stdout ?? '',
      stderr: osResult?.stderr ?? '',
    },
    parsed_ports: ports,
    parsed_os: os,
  };
  const transcriptPath = join(dir, 'transcripts', `recon-${ts}.json`);
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf-8');

  const portsPath = join(dir, 'ports.yml');
  await writeFile(portsPath, portsToYaml(target, ports, {
    timestamp, argv: svResult.argv, code: svResult.code,
  }), 'utf-8');

  const osPath = join(dir, 'os.yml');
  await writeFile(osPath, osToYaml(target, os, {
    timestamp, argv: osArgv, code: osResult?.code ?? -1, reason: osReason,
  }), 'utf-8');

  return {
    slug, dir, created, target,
    ports_file: portsPath,
    os_file: osPath,
    transcript: transcriptPath,
    nmap_argv: svResult.argv,
    exit_code: svResult.code,
    wall_ms: svResult.wallMs,
    ports,
    os,
  };
}

// ---------- CLI ----------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    log.error('usage: node lib/recon.mjs <target> [-- nmap-extra-args…]');
    process.exit(2);
  }
  const sepIdx = argv.indexOf('--');
  const target = argv[0];
  const extraArgs = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
  try {
    const r = await recon(target, { extraArgs });
    process.stdout.write(JSON.stringify({
      slug: r.slug, dir: r.dir, created: r.created, target: r.target,
      ports_file: r.ports_file, os_file: r.os_file, transcript: r.transcript,
      nmap_argv: r.nmap_argv, exit_code: r.exit_code, wall_ms: r.wall_ms,
      ports: r.ports, os: r.os,
    }, null, 2) + '\n');
    process.exit(r.exit_code === 0 ? 0 : 1);
  } catch (e) {
    log.error(`recon: ${e.message}`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
