// docker exec wrapper for the long-lived `banadi` kali container.
// All tool execution (nmap, curl, …) routes through here so the host
// stays clean and every invocation can be transcripted uniformly.
// Importable helper only — the MCP `banadi.exec` tool is the operator surface.

import { spawn } from 'node:child_process';

const CONTAINER = process.env.BANADI_CONTAINER ?? 'banadi';

/**
 * Run argv inside the banadi container. Returns { stdout, stderr, code, wallMs, argv }.
 * Never throws on non-zero exit — caller decides what to do with `code`.
 */
export function execIn(argv, opts = {}) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('execIn: argv must be a non-empty array');
  }
  const container = opts.container ?? CONTAINER;
  const fullArgv = ['exec', container, ...argv];
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('docker', fullArgv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('error', (e) => reject(new Error(`execIn: spawn failed: ${e.message}`)));
    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        code,
        wallMs: Date.now() - t0,
        argv: fullArgv,
        container,
      });
    });
  });
}
