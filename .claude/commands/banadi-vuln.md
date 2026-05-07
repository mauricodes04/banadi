---
description: Vuln-prep — fetch hackviser per-service, synthesize pent/<port>.mjs from open ports
---

Argument: `<target-or-slug>` — either the same target string passed to `/banadi-recon`, or an existing engagement slug. Optional flags: `--force` (overwrite existing `pent/<port>.mjs`), `--refresh` (re-fetch hackviser even if cached).

## Steps

1. Load [modes/_shared.md](../../modes/_shared.md) then [modes/vuln.md](../../modes/vuln.md). Follow the synthesis rules in vuln.md exactly.
2. Resolve the slug. If the arg matches an existing engagement directory, use it directly. Otherwise pass it through `lib/engagement.mjs.slugify` and verify the directory exists; if it does not, stop and recommend `/banadi-recon <target>` first.
3. Run `node lib/vuln.mjs <slug> [--force] [--refresh]` via Bash. Parse the stdout JSON.
4. **For each entry in `generate[]`**, in order:
   - `Read` the file at `cache_path`.
   - Synthesize the `pent/<port>.mjs` content per the shape rules in [modes/vuln.md](../../modes/vuln.md).
   - `Write` to `target_path` (use the path verbatim from the JSON).
   - If the cache file is a 404 / empty / clearly not the right page, skip the write and note the skip.
5. Surface to the operator a five-section summary:
   - **Created** — list of `pent/<port>.mjs` newly written, with the service slug.
   - **Kept** — entries from `exists[]` (untouched, no work needed).
   - **Skipped (synthesis)** — entries where the cache was unusable.
   - **Auto-mapped** — entries from `auto_mapped[]`. Phrase each as "`<service>` → `<slug>` (via `<via>`)" so the operator sees which mappings came from the catalog or port-fallback rather than the curated alias table. Skip the section entirely if `auto_mapped[]` is empty.
   - **Unmapped / no-service** — combined `unmapped[]` + `skipped_service[]`. Phrase as "add to [lib/services.mjs](../../lib/services.mjs) to enable: `<service>` (port `<port>`)". If a service is genuinely a hackviser slug that's missing from the catalog, suggest re-running `node scripts/refresh-services-catalog.mjs` first.
6. Mention the transcript path (`transcript` field of the JSON).

## Refusals

- Engagement not found → stop, recommend `/banadi-recon <target>`.
- `ports.yml` missing or empty → stop, recommend `/banadi-recon <target>` to populate it.
- All ports unmapped or skipped → no synthesis to do; print the summary and exit cleanly. This is normal for early stages of the service map — the operator extends `lib/services.mjs` and re-runs.

## Out of scope (stage 2)

- Executing any `cmd` array you wrote into a `pent/<port>.mjs`. That's stage 3.
- Sources other than hackviser.
- CVE-database lookups, exploit-db, HackTricks. Hackviser only.
