---
description: Preflight — docker, banadi container, in-container nmap, disk
---

Run `node lib/doctor.mjs` via Bash from the repository root. The script emits progress to stderr and a single JSON object `{ overall, checks, env, timestamp }` to stdout.

Parse stdout as JSON and present a compact report to the operator:

- **overall === "ok"** — one-line green summary (`doctor: green (N checks)`), then one line per check as `name: detail`.
- **overall === "warn"** — list every check with its status marker; call out warnings explicitly but note the environment is usable.
- **overall === "fail"** — show every failed check verbatim with its `detail` field. If `docker` failed, advise the operator to start Docker Desktop and retry. If `banadi-image` or `banadi-container` failed, advise `bash scripts/banadi-up.sh` (Linux/macOS/WSL) or `powershell -ExecutionPolicy Bypass -File scripts/banadi-up.ps1` (Windows + Docker Desktop) to build/start the kali container.

Do not re-run the script. Do not invoke any other tools during this command.
