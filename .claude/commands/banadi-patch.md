---
description: Patch — enumerate local installed programs, LLM triage for malware/CVEs/cleanup
---

No arguments. Implicit target is the local Windows host. Unlike the network-scan commands, this runs on the host, not inside the banadi container — PowerShell is Windows-only and the registry lives on the host.

## Steps

1. Load [modes/_shared.md](../../modes/_shared.md) then [modes/patch.md](../../modes/patch.md). Follow the triage rules and report template in patch.md exactly.
2. Run `node lib/patch.mjs` via Bash. The wrapper:
   - resolves engagement slug from `os.hostname()`,
   - ensures `engagements/<slug>/patches/<unix_ts>/` exists,
   - shells `powershell.exe -NoProfile -Command …` to dump the registry uninstall keys to `installed_programs.csv`,
   - writes `engagements/<slug>/transcripts/patch-<unix_ts>.json`,
   - prints JSON on stdout: `{ slug, csv_path, report_path, transcript_path, hostname, program_count, exit_code, … }`.
3. If `exit_code !== 0`, surface stderr from the transcript and stop. Do not retry automatically.
4. `Read` the CSV at `csv_path`.
5. Triage per [modes/patch.md](../../modes/patch.md): classify rows into malware/pirated, CVE-flagged, remote-access/kernel-level, and the ten fixed category buckets.
6. `Write` `report.md` at `report_path` using the template verbatim. Replace every `<placeholder>` with concrete content.
7. Surface to the operator a four-line summary:
   - `slug=<slug>  programs=<count>`
   - `csv: <csv_path>`
   - `report: <report_path>`
   - `transcript: <transcript_path>`

## Refusals

- `lib/patch.mjs` exits non-zero on non-Windows hosts. If the operator runs `/banadi-patch` from WSL/Linux/macOS, surface that error and stop — there's no fallback.
- `installed_programs.csv` empty (zero programs enumerated): something blocked PowerShell from reading the registry. Surface stderr from the transcript and stop; do not write an empty `report.md`.

## Out of scope

- Uninstalling, updating, or otherwise modifying the host. This command is read-only triage. Cleanup actions are operator-driven.
- Per-CVE NVD verification (`/banadi-cve` is the verified path). Patch-mode CVE flags are LLM judgment calls, conservative and unverified.
- Non-Windows hosts. macOS / Linux equivalents (`brew list`, `dpkg -l`, etc.) are not implemented.
