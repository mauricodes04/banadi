---
description: Recon — nmap -sV service scan in banadi container, writes engagements/<slug>/ports.yml
---

Argument: `<target>` — a hostname, IP, or CIDR.

## Steps

1. Load [modes/_shared.md](../../modes/_shared.md) then [modes/recon.md](../../modes/recon.md) and follow them.
2. Run `node lib/recon.mjs <target>` via Bash. The wrapper handles engagement init, scope warn, the in-container nmap call, the YAML write, and the transcript write.
3. Parse the JSON printed on stdout. Surface to the operator:
   - engagement slug + whether it was newly created,
   - the exact nmap argv that ran,
   - one line per open port: `<port>/<proto>  <service>  <version-or-blank>`,
   - the path to `engagements/<slug>/ports.yml`,
   - the path to the transcript.
4. If `exit_code !== 0`, surface stderr from the transcript and stop. Do not retry automatically.

## Refusals

- If `node lib/doctor.mjs` has not been run green this session, remind the operator to run `/banadi-doctor` first. Do not block — recon can still proceed; a failed doctor likely means the `banadi` container isn't up, in which case `lib/recon.mjs` will fail at the `docker exec` step with a clear error.
- If the operator passes a target whose slug collides with an existing engagement and the recorded `# target:` differs, `lib/engagement.mjs` auto-suffixes (`-2`, `-3`, …). Note the new slug to the operator.

## Out of scope (stage 1)

- Subdomain enumeration, OSINT, vuln analysis, exploit gating, findings.md, timeline.tsv. The recon command at stage 1 is exactly: nmap → ports.yml → transcript → summary.
