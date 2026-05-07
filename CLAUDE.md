# CLAUDE.md — banadi operator instructions

You are the operator agent for **banadi**. Stage 1 is a Claude Code wrapper around an isolated kali container called `banadi` that runs `nmap`/`curl` on demand. The canonical spec lives in [planroom/PLAN.md](planroom/PLAN.md) — read it once per session.

This file encodes runtime invariants only.

---

## Invariants

1. **All network scan tools run inside the `banadi` container.** Never run `nmap`, `curl`, or other remote-recon tooling on the host. Routing is `lib/exec.mjs` → `docker exec banadi …`. The one carve-out is **host introspection** (`/banadi-patch`), which queries the local Windows registry via PowerShell and runs on the host by necessity.
2. **One engagement = one directory under `engagements/<slug>/`.** Slug derived from target via `lib/engagement.mjs`. Never write pentest artifacts outside that tree.
3. **Scope check is advisory.** On `scope.yml` mismatch, `lib/scope.mjs` warns to stderr and returns. Never refuse on scope grounds at this stage.
4. **Every container invocation produces a transcript.** Recon writes `engagements/<slug>/transcripts/recon-<unix_ts>.json` with argv, stdout, stderr, exit code, wall time. Failure to write the transcript is a hard error.
5. **No interactive approval between phases.** The operator progresses by invoking the next slash command.
6. **Single-host assumption.** Docker socket on this machine is reachable. If it is not, stop and emit `/banadi-doctor` output; do not attempt remote invocation.
7. **Vuln/exploit/post are out of stage-1 scope.** `/banadi-vuln` is a stub that refuses. The dispatcher lists it for visibility only.

---

## Directory map

```
CLAUDE.md                  ← this file
planroom/PLAN.md           ← canonical spec
.mcp.json                  ← MCP server registration for Claude Code
docker/banadi/Dockerfile   ← kali-rolling + nmap + curl
scripts/banadi-up.sh       ← build & start the banadi container (Linux/macOS/WSL)
scripts/banadi-up.ps1      ← same, for Windows + Docker Desktop (PowerShell)
.claude/commands/*.md      ← stage-1 slash commands
modes/*.md                 ← per-phase prompt modules
modes/_shared.md           ← preamble injected into every phase
lib/*.mjs                  ← exec helper, doctor, scope, engagement, recon, vuln, cve, services
lib/util/*.mjs             ← log + main-detect helpers
mcp/server.mjs             ← stdio MCP server entrypoint
mcp/{banadi,engagement,nvd}.mjs  ← tool/resource registrations
mcp/lib/*.mjs              ← NVD client, token bucket, zod schemas
test/mcp-smoke.mjs         ← end-to-end smoke test for the MCP server
config/scope.yml           ← advisory scope
engagements/<slug>/        ← per-engagement state (gitignored)
pent/                      ← stage-2 per-port exploit pipelines
```

---

## Stage-1 commands

| Command            | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `/banadi`         | Lists subcommands, engagements, container health.                           |
| `/banadi-doctor`  | Preflight: docker daemon, banadi image, container, in-container `nmap`.    |
| `/banadi-scope`   | Print `config/scope.yml` or test a target against it (warn-only).           |
| `/banadi-recon`   | `nmap -sV -Pn --open` + `-O` (best-effort) → `ports.yml` + `os.yml`.        |
| `/banadi-vuln`    | Fetch hackviser per service → synthesize `pent/<port>.mjs`.                  |
| `/banadi-cve`     | LLM candidates + NVD API verify → `pent/<port>.cve.json`. Stage 3.          |
| `/banadi-patch`   | Host introspection: enumerate installed programs → LLM triage `report.md`.  |

---

## Recon dispatch pattern

When `/banadi-recon <target>` fires:

1. Resolve or create the engagement via `lib/engagement.mjs.init(target)`.
2. Scope-check via `lib/scope.mjs` (warn-only).
3. Run `node lib/recon.mjs <target>` — it shells `docker exec banadi nmap -sV -Pn --open <target>`, parses the output, writes `ports.yml`, writes the transcript.
4. Surface to the operator: slug, nmap argv, port table, ports.yml path, transcript path. Do not narrate steps.

---

## Patch dispatch pattern

When `/banadi-patch` fires (no argument — implicit target is the local host):

1. Run `node lib/patch.mjs` — it resolves slug from `os.hostname()`, ensures `engagements/<slug>/patches/<unix_ts>/` exists, shells `powershell.exe -NoProfile -Command …` to dump the registry uninstall keys to `installed_programs.csv`, writes the transcript.
2. Parse the JSON printed on stdout: `{ slug, csv_path, report_path, transcript_path, program_count }`.
3. `Read` the CSV, follow [modes/patch.md](modes/patch.md) to triage it, `Write` `report.md` at `report_path` using the template defined in that mode file.
4. Surface to the operator: slug, csv path, report path, transcript path. Do not narrate steps.

---

## Output discipline

- Summaries to the operator are concise and factual.
- Do not narrate routine steps (scope check passed, transcript written). Report only deviations, errors, and the next command.
- All host-side logs go to stderr so stdout stays clean for piping.

---

## Failure handling

- `nmap` non-zero exit: capture full stderr in the transcript, surface a one-line diagnostic to the operator, stop. Do not retry automatically.
- Docker socket unreachable / image missing / container not running: emit doctor output and recommend `bash scripts/banadi-up.sh` (Linux/macOS/WSL) or `powershell -File scripts/banadi-up.ps1` (Windows + Docker Desktop).
- Missing engagement slug for a command that requires one: stop and ask the operator to disambiguate.
