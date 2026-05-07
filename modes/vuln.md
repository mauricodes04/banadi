# Vuln mode

Per-port pentesting documentation, synthesized from hackviser. The deliverable is one `pent/<port>.mjs` file per open port whose service is mapped in [lib/services.mjs](../lib/services.mjs). Each `.mjs` is a static export — no execution at this stage. Stage 3 will consume these files to drive actual probes.

Load `modes/_shared.md` first.

## Pipeline (synthesis is the LLM step — that's *you*)

1. Run `node lib/vuln.mjs <slug> [--force] [--refresh]`. Read its stdout JSON.
2. The JSON contains four buckets:
   - `generate[]` — ports needing a fresh `pent/<port>.mjs`. Each entry has `port, protocol, service, version, hackviser_slug, hackviser_url, cache_path, target_path, overwrite`.
   - `exists[]` — ports whose `pent/<port>.mjs` is already on disk (kept).
   - `unmapped[]` — ports whose service is not in `lib/services.mjs` (manual review).
   - `skipped_service[]` — ports with `tcpwrapped`/`unknown`/empty service (no fetch attempted).
3. For each entry in `generate[]`:
   - `Read` the cached HTML at `cache_path`. It is the hackviser tactics page for `hackviser_slug`.
   - Synthesize a `pent/<port>.mjs` matching the **shape** below.
   - `Write` the file to `target_path` (verbatim path; do not re-derive).

## `pent/<port>.mjs` shape (strict)

Default-export a single object. Property order matters for diff readability — keep it.

```js
export default {
  port: <number>,
  protocol: <'tcp' | 'udp'>,
  service: <string from ports.yml>,         // raw nmap service name
  version: <string | null>,                  // raw nmap version banner
  reference: <hackviser_url>,                // single canonical source

  enumeration: [
    { name: 'banner-grab',
      cmd: ['nc', '-vn', '<target>', '<port>'],
      note: 'one-line purpose + what to look for in output' },
    // …
  ],

  vulnerability_checks: [
    { name: 'weak-host-key',
      cmd: ['ssh-keyscan', '-t', 'rsa,ed25519', '<target>'],
      note: '…' },
    // …
  ],

  exploitation: [
    { name: 'cred-spray',
      cmd: ['hydra', '-L', 'users.txt', '-P', 'pass.txt', 'ssh://<target>'],
      note: 'noisy; only with explicit auth — see scope.yml' },
    // …
  ],

  notes: `Free-form analysis tying the parsed nmap version banner to known
issues. 4–10 lines. Mention CVE IDs only when stated explicitly on the
hackviser page or directly implied by the version banner — do not invent.`,
};
```

## Synthesis rules

- **Source discipline.** Every command in the three lists must come from (or be a clear derivation of) the hackviser page. If the page doesn't list it, don't add it. No external tools or memory-pulled commands.
- **`<target>` literal.** Use the literal string `<target>` (not the actual hostname) wherever a target goes. Same for `<port>` when the port number is variable. Stage 3 will substitute.
- **`cmd` arrays, not strings.** Each command is a string array suitable for `execIn(argv)`. Quote nothing — let the array boundaries speak.
- **Bucket assignment.**
  - `enumeration` = passive/banner/version/path discovery. Read-only style.
  - `vulnerability_checks` = tests for known weaknesses (weak ciphers, missing auth, default config). May be slightly noisier but still non-destructive.
  - `exploitation` = active brute-force, RCE attempts, exploits. Anything that flips state or makes noise.
- **`notes`** is the only free-form field. Anchor it to the parsed `version` banner from `ports.yml` — what's known about *this version*. If hackviser doesn't speak to the version, say so explicitly.
- **Skip silently** if the page is empty or the cache file looks like a 404. Better to leave `pent/<port>.mjs` unwritten than to ship a hollow file. Note the skip in the operator summary.

## Output expectations

- One `pent/<port>.mjs` written per `generate[]` entry (or skip-noted).
- Existing `pent/<port>.mjs` files are not touched unless `--force`.
- Operator summary lists: created, kept, skipped (with reason). Lists `unmapped[]` separately as "add to lib/services.mjs to enable".

## Do not

- Execute any of the commands you put in the .mjs. That's stage 3.
- Re-fetch hackviser. The cache is the source of truth for this run.
- Embed hackviser HTML in the .mjs. Reference the URL only.
- Append to `pent/<port>.mjs` — overwrite atomically or not at all.
