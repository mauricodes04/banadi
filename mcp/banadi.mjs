// banadi.* tools: exec / curl / write_tmp / read_tmp.
// Wraps lib/exec.mjs#execIn so the host stays clean; bodies that contain
// payload text never touch host disk during the round-trip.

import { spawn } from 'node:child_process';
import { execIn } from '../lib/exec.mjs';
import {
  banadiExecInput,
  banadiCurlInput,
  banadiWriteTmpInput,
  banadiReadTmpInput,
} from './lib/schemas.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_CONTAINER = process.env.BANADI_CONTAINER ?? 'banadi';

function execInWithTimeout(argv, opts) {
  const ms = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer;
  const exec = execIn(argv, opts).then((r) => { clearTimeout(timer); return r; });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${argv.join(' ')}`)), ms);
  });
  return Promise.race([exec, timeout]);
}

// docker exec -i <container> tee <path> — body via stdin, never on host disk.
function execInStdin(argv, body, { container = DEFAULT_CONTAINER, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fullArgv = ['exec', '-i', container, ...argv];
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('docker', fullArgv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`spawn failed: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`timeout after ${timeoutMs}ms`));
      resolve({ stdout, stderr, code, wallMs: Date.now() - t0, argv: fullArgv, container });
    });
    child.stdin.end(body, 'utf-8');
  });
}

function ok(structured) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function err(message, extra = {}) {
  const payload = { error: message, ...extra };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function register(mcp) {
  mcp.registerTool(
    'banadi.exec',
    {
      description: 'Run argv inside the long-lived banadi kali container via docker exec. Never throws on non-zero; caller inspects code.',
      inputSchema: banadiExecInput,
    },
    async ({ argv, timeout_ms, container }) => {
      try {
        const r = await execInWithTimeout(argv, {
          container: container ?? DEFAULT_CONTAINER,
          timeoutMs: timeout_ms ?? DEFAULT_TIMEOUT_MS,
        });
        return ok(r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  mcp.registerTool(
    'banadi.curl',
    {
      description: 'Convenience wrapper around banadi.exec for HTTP fetches. Headers stay in argv; no host file ever holds the body.',
      inputSchema: banadiCurlInput,
    },
    async ({ url, headers, max_time }) => {
      const argv = ['curl', '-fsSL', '--max-time', String(max_time ?? 30)];
      for (const [k, v] of Object.entries(headers ?? {})) argv.push('-H', `${k}: ${v}`);
      argv.push(url);
      try {
        const r = await execInWithTimeout(argv, { container: DEFAULT_CONTAINER });
        return ok(r);
      } catch (e) {
        return err(e.message);
      }
    }
  );

  mcp.registerTool(
    'banadi.write_tmp',
    {
      description: 'Write a string body to <path> inside the container (only /tmp/ paths). Body never lands on the host.',
      inputSchema: banadiWriteTmpInput,
    },
    async ({ path, body }) => {
      try {
        const r = await execInStdin(['tee', path], body);
        if (r.code !== 0) return err(`tee exit ${r.code}: ${r.stderr.trim()}`);
        return ok({ path, bytes: Buffer.byteLength(body, 'utf-8') });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  mcp.registerTool(
    'banadi.read_tmp',
    {
      description: 'Read up to max_bytes from <path> inside the container (only /tmp/ paths).',
      inputSchema: banadiReadTmpInput,
    },
    async ({ path, max_bytes }) => {
      const cap = max_bytes ?? 1048576;
      try {
        const r = await execInWithTimeout(['head', '-c', String(cap), path]);
        if (r.code !== 0) return err(`read failed exit ${r.code}: ${r.stderr.trim()}`);
        const truncated = Buffer.byteLength(r.stdout, 'utf-8') >= cap;
        return ok({ path, body: r.stdout, truncated });
      } catch (e) {
        return err(e.message);
      }
    }
  );
}
