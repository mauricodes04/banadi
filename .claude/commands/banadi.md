---
description: Dispatcher — lists subcommands, current engagements, container health
---

No arguments. Informational only — does not run any container command or modify engagement state.

## Steps

1. Present the subcommand menu:

   ```
   /banadi-doctor             — preflight: docker / banadi container / nmap / disk
   /banadi-scope [target]     — print scope.yml or test a target against it
   /banadi-recon  <target>    — nmap -sV + -O scans → ports.yml + os.yml
   /banadi-vuln   <target>    — hackviser fetch per service → pent/<port>.mjs
   /banadi-cve    <target>    — LLM + NVD lookup per port  → pent/<port>.cve.json  [stage 3]
   /banadi-patch              — enumerate local installed programs → LLM triage → report.md
   ```

2. List existing engagements: `node lib/engagement.mjs list`. Report each slug on its own line. If none, say so.

3. One-line container health. Call `node lib/doctor.mjs 2>/dev/null` and report only the `overall` field:
   - `doctor: green` — no further detail.
   - `doctor: warn` — list the warn'd check names.
   - `doctor: fail` — list the failed check names and advise `/banadi-doctor` for the full report.

## Do not

- Attempt any phase dispatch. This is a status command only.
- Synthesize engagement status beyond what `lib/engagement.mjs list` returns.
