---
description: CVE research (stage 3) — LLM + NVD lookup per open port, writes pent/<port>.cve.json
---

Argument: `<target-or-slug>` — same target string from `/banadi-recon`, or an existing engagement slug. Optional flag: `--force` to overwrite existing `.cve.json` files.

## Steps

1. Load [modes/_shared.md](../../modes/_shared.md) then [modes/cve.md](../../modes/cve.md). Follow the CVE reasoning and verification rules in cve.md exactly.
2. Resolve the slug (same logic as `/banadi-vuln`). Stop and recommend `/banadi-recon <target>` if the engagement doesn't exist.
3. Verify `ports.yml` exists in the engagement dir. Stop and recommend `/banadi-recon` if missing.
4. Run `node lib/cve.mjs <slug> [--force]` via Bash. Parse stdout JSON.
5. Note the `os` field — it informs which distro-specific CVEs apply. If `os` is null, note this to the operator and proceed without OS filtering.
6. For each entry in `generate[]`, in order, follow the pipeline in [modes/cve.md](../../modes/cve.md):
   - `Read` `pent_path` for version context.
   - Reason about candidate CVE IDs.
   - Verify each candidate via the `nvd.cve` MCP tool. Use `nvd.search` / `nvd.cves_for_service` when the candidate set needs widening. Only fall back to `banadi.curl` against the NVD REST API if the MCP tools error out.
   - `Write` the verified result to `cve_path`.
7. Surface a four-section summary:
   - **Created** — `pent/<port>.cve.json` files written, with CVE count per port.
   - **Kept** — existing files untouched.
   - **Skipped** — ports with no `.mjs` yet (operator needs `/banadi-vuln` first).
   - **NVD failures** — any `nvd_unavailable` results or other tool errors (retry manually if needed).
8. Mention the transcript path (from the cve-prep JSON).

## Refusals

- Engagement or `ports.yml` not found → stop, recommend `/banadi-recon`.
- All ports are in `skipped[]` (no `.mjs` files) → stop, recommend `/banadi-vuln <target>` first.
- `pent/<port>.cve.json` already exists and `--force` not set → keep and skip; list in **Kept**.

## NVD rate limit

The public NVD API allows ~5 requests per 30 seconds unauthenticated. Do not fire parallel curls. If you hit a 403 or 429, wait 30 seconds and retry once. If the retry also fails, log it in **NVD failures** and move on — do not block the remaining ports.

## Stage 4 note

`stage4_hint` fields in the `.cve.json` output are placeholders for stage 4 (command execution inside the container). They use `<target>` as a literal placeholder. Stage 4 is not implemented yet — do not execute them.
