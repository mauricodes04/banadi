This is my general outline of how I want banadi to work.

This program should be used with claude code and command executions like:
/banadi to see available commands.
/banadi-doctor to check if docker container is up and llms are active.
/banadi-scope to print the current scope `config/scope.yml` and pings each for an "OK" echo
/banadi-recon <target>
/banadi-vuln <target>

Create a docker container {called banadi} with kali/terminal for isolated environment code executions (e.g. nmap) in this repo.

/banadi-recon
Starts reconnisance mode `modes/recon.md.mjs.youchoose`;

If current <target> doesnt have a file in `engagements/`, then create one. (e.g. scanme.nmap.com becomes `engagements/scanme-nmap-com/`)

Run an nmap scan at <target> (preferably with flags -sV for starters but up to your choosing for best quality output) in docker environment.
Document NMAP results in `engagements/target-name/ports.yml.json.md.youchoose`: port, service, filtered/open

Deliverables for /banadi-recon <target>:
1. Unique folder for <target> in `engagements/`
2. ports.file in `engagements/<target>/`
3. Summary of nmap command used and ports and services found.

-=+=-

/banadi-vuln <target>
Vulnerability pentesting documentation creation `modes/vuln.md.mjs.youchoose`

Sees `engagements/target-name/ports.yml.json.md.youchoose`
For every port:
Gather pentesting information by using CURL, here are some examples of where to start.
`https://hackviser.com/tactics/pentesting/services/imap` for ports 143 and 993
`https://hackviser.com/tactics/pentesting/services/http` for ports 80, 443, 8080, 8443
`https://hackviser.com/tactics/pentesting/services/ssh` for port 22

Extract information and feed into LLM to create in `pent/`

<port>.mjs
143.mjs
993.mjs
80.mjs
443.mjs
8080.mjs
etc.

this .mjs script will have the workflow/pipeline of how to exploit the ports.
This .mjs script will include commands to run, continuous memory documentation, and local analysis and interpretation of results using the LLM.

Deliverables for /banadi-vuln <target>:
1. `pent/` directory if not exist.
2. Additions to port pentesting instruction in `pent/` (Amount can vary, machine learning)
3. Short summary of ONLY what has been created; files, folders.


Stage 1 will be completed once /banadi-recon works and the deliverables are met;
1. Docker container
2. `engagements/`
3. `modes/`
4. `modes/recon.md`
5. `modes/vuln.md`
6. `pent/`
7. `config/scope.yml`
8. Deliverables for /banadi-recon

Ask any questions throughout your process to get a better understanding. maintain minimal code and clear documentation. Don't guess, ask first and I may let you decide.

### as of 4/28, stage 1 and 2 are completed!!

Possible revisions:
Goal: get better exploitation documentation for selected ports and operating system of <target>
Method: Search CVEs with information from /banadi-recon
Tools: research possible options, not limited to: CVE websearch from sites like cve.org, local database of CVEs to search from, you *LLM* find possible options
Deliverable: Plan to increase scope of vuln research by finding appropriate pentesting information, having an llm interpret it and develop a script/plan for another LLM to enact for stage 3

-=+=-

## MCP server (completed 4/30)

`mcp/server.mjs` exposes `banadi.{exec,curl,write_tmp,read_tmp}`, `nvd.{cve,search,cves_for_service}`, and `engagement://<slug>/{ports.yml,os.yml,scope.yml,transcripts/*}` resources. Wired in `.mcp.json`. The NVD client (`mcp/lib/nvd-client.mjs`) caches under `.cache/nvd/` with token-bucket pacing and 503/timeout retry. 

Smoke test: `npm run mcp:smoke`.

### Open follow-up: migrate stage-1 shell-outs to MCP tools

Each slash command currently shells out to `node lib/<phase>.mjs <args>` via Bash and parses stdout JSON. The `lib/*` modules already expose pure-JS exports (`recon`, `prepare` in vuln.mjs and cve.mjs, `match` in scope.mjs, the doctor checks). Wrapping those exports as MCP tools is mostly plumbing, not redesign.

Proposed surface, all under the existing `banadi` server:

| Tool                    | Input                                | Returns                                              | Replaces                  |
| ----------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------- |
| `recon.scan`            | `{ target, extra_args?, timeout_ms? }` | `{ slug, ports, os, ports_file, os_file, transcript }` | `node lib/recon.mjs`      |
| `vuln.prepare`          | `{ slug, force?, refresh? }`         | the current `lib/vuln.mjs` JSON (`generate[]` etc.)  | `node lib/vuln.mjs`       |
| `cve.prepare`           | `{ slug, force? }`                   | the current `lib/cve.mjs` JSON                       | `node lib/cve.mjs`        |
| `scope.match`           | `{ target? }`                        | `{ path, entries }` or `{ matched, entry }`          | `node lib/scope.mjs`      |
| `doctor.check`          | `{}`                                 | the current `lib/doctor.mjs` report                  | `node lib/doctor.mjs`     |
| `engagement.list`       | `{}`                                 | `{ slugs[] }`                                        | `node lib/engagement.mjs list` |

Implementation steps:

1. Add `mcp/recon.mjs`, `mcp/vuln.mjs`, `mcp/cve.mjs`, `mcp/scope.mjs`, `mcp/doctor.mjs`, `mcp/engagement-tools.mjs` (kept separate from `mcp/engagement.mjs` resource provider). Each is a one-screen file: import the existing `lib/<x>` export, wrap with `ok()`/`err()` envelopes, define a zod input schema in `mcp/lib/schemas.mjs`.
2. Register them all in `mcp/server.mjs`.
3. Update `.claude/commands/banadi-*.md` and `modes/*.md` to invoke `mcp__banadi__<tool>` instead of Bash-running `node lib/<phase>.mjs`.
4. Update `.claude/settings.json` to allow the new tools (read-only ones auto-allow; `recon.scan` and `vuln.prepare` may want per-call approval since they fire `nmap`/`curl` against external hosts).
5. Extend `test/mcp-smoke.mjs` with at least one assertion per new tool.
6. Once green, decide per-CLI whether to keep the `if (isMain) main()` block in `lib/<x>.mjs` as a debugging crutch or drop it like we did for `lib/exec.mjs`. (Keeping it costs nothing; dropping it removes another way to drift between MCP and CLI behavior.)

Stage-4 (`pent.execute(port, step_name, target)` — execute one `cmd[]` from `pent/<port>.mjs` with per-call approval) lands on top of this same surface. Not in scope here.
