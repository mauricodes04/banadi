// engagement://* resources. URI shape:
//   engagement://<slug>/ports.yml
//   engagement://<slug>/os.yml
//   engagement://<slug>/scope.yml
//   engagement://<slug>/transcripts          (directory listing as JSON)
//   engagement://<slug>/transcripts/<basename>
//
// `fs.watch(engagementsRoot, { recursive: true })` debounces 250ms and
// fires `notifications/resources/updated` for ports.yml / os.yml.

import { existsSync, watch } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { engagementsRoot, list as listSlugs } from '../lib/engagement.mjs';
import { log } from '../lib/util/log.mjs';

const ROOT = engagementsRoot();

const FILE_MIME = {
  'ports.yml': 'application/yaml',
  'os.yml': 'application/yaml',
  'scope.yml': 'application/yaml',
};

async function safeStat(path) {
  try { return await stat(path); } catch { return null; }
}

async function listResources() {
  const slugs = await listSlugs().catch(() => []);
  const out = [];
  for (const slug of slugs) {
    const dir = join(ROOT, slug);
    for (const name of ['ports.yml', 'os.yml', 'scope.yml']) {
      if (existsSync(join(dir, name))) {
        out.push({
          uri: `engagement://${slug}/${name}`,
          name: `${slug} / ${name}`,
          mimeType: FILE_MIME[name],
        });
      }
    }
    const txDir = join(dir, 'transcripts');
    if (existsSync(txDir)) {
      out.push({
        uri: `engagement://${slug}/transcripts`,
        name: `${slug} / transcripts (index)`,
        mimeType: 'application/json',
      });
      try {
        const files = await readdir(txDir);
        for (const f of files) {
          out.push({
            uri: `engagement://${slug}/transcripts/${f}`,
            name: `${slug} / transcripts / ${f}`,
            mimeType: 'application/json',
          });
        }
      } catch { /* ignore */ }
    }
  }
  return out;
}

function parseUri(uriStr) {
  const m = uriStr.match(/^engagement:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const slug = m[1];
  const tail = m[2];
  if (tail === 'transcripts') return { slug, kind: 'tx_index' };
  if (tail.startsWith('transcripts/')) {
    const name = tail.slice('transcripts/'.length);
    if (name.includes('/')) return null;
    return { slug, kind: 'tx_file', name };
  }
  if (FILE_MIME[tail]) return { slug, kind: 'file', name: tail };
  return null;
}

async function readResource(uriStr) {
  const parsed = parseUri(uriStr);
  if (!parsed) throw new Error(`unknown engagement uri: ${uriStr}`);
  const dir = join(ROOT, parsed.slug);
  if (!existsSync(dir)) throw new Error(`engagement not found: ${parsed.slug}`);

  if (parsed.kind === 'file') {
    const path = join(dir, parsed.name);
    const text = await readFile(path, 'utf-8');
    return { contents: [{ uri: uriStr, mimeType: FILE_MIME[parsed.name], text }] };
  }
  if (parsed.kind === 'tx_index') {
    const txDir = join(dir, 'transcripts');
    const files = existsSync(txDir) ? await readdir(txDir) : [];
    return {
      contents: [{
        uri: uriStr,
        mimeType: 'application/json',
        text: JSON.stringify({ slug: parsed.slug, transcripts: files.sort() }, null, 2),
      }],
    };
  }
  if (parsed.kind === 'tx_file') {
    const path = join(dir, 'transcripts', parsed.name);
    const text = await readFile(path, 'utf-8');
    return { contents: [{ uri: uriStr, mimeType: 'application/json', text }] };
  }
  throw new Error(`unhandled engagement uri: ${uriStr}`);
}

export function register(mcp) {
  // Single template covers every variant; SDK calls listCallback to enumerate.
  const template = new ResourceTemplate('engagement://{slug}/{+path}', {
    list: async () => ({ resources: await listResources() }),
  });

  mcp.registerResource(
    'engagement',
    template,
    {
      description: 'Per-engagement artifacts (ports.yml, os.yml, scope.yml, transcripts/*).',
    },
    async (uri) => readResource(uri.href ?? String(uri))
  );

  startWatcher(mcp);
}

function startWatcher(mcp) {
  if (!existsSync(ROOT)) return;
  const pending = new Map();
  let watcher;
  try {
    watcher = watch(ROOT, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const norm = filename.replace(/\\/g, '/');
      const m = norm.match(/^([^/]+)\/(ports\.yml|os\.yml|scope\.yml)$/);
      if (!m) return;
      const uri = `engagement://${m[1]}/${m[2]}`;
      clearTimeout(pending.get(uri));
      pending.set(uri, setTimeout(async () => {
        pending.delete(uri);
        const exists = await safeStat(join(ROOT, m[1], m[2]));
        if (!exists) return;
        try {
          await mcp.server.sendResourceUpdated({ uri });
        } catch (e) {
          log.warn(`engagement watcher: sendResourceUpdated failed: ${e.message}`);
        }
      }, 250));
    });
    watcher.on('error', (e) => log.warn(`engagement watcher error: ${e.message}`));
  } catch (e) {
    log.warn(`engagement watcher disabled: ${e.message}`);
  }
}
