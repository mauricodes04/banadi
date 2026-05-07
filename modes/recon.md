# Recon mode

Run an `nmap -sV` service scan against `<target>` from inside the `banadi` kali container. Document open ports + services in `engagements/<slug>/ports.yml`.

Load `modes/_shared.md` first.

## Tools

- `nmap` (in-container). Default flags: `-sV -Pn --open` plus `<target>`. `-sV` for service/version detection; `-Pn` to skip host discovery (scanme-style hosts often drop ICMP); `--open` to keep the report focused on actionable rows.
- All execution routes through `lib/exec.mjs` → `docker exec banadi …`. Never invoke `nmap` on the host.

## Flow

1. Resolve or create the engagement via `lib/engagement.mjs.init(target)` — idempotent, returns `{ slug, dir, created }`.
2. Scope-check the target via `lib/scope.mjs` (warn-only).
3. Run `node lib/recon.mjs <target>`. The wrapper:
   - shells out to `docker exec banadi nmap -sV -Pn --open <target>`,
   - parses the line-mode output into `{ port, protocol, state, service, version }` rows,
   - writes `engagements/<slug>/ports.yml`,
   - writes a JSON transcript to `engagements/<slug>/transcripts/recon-<unix_ts>.json`.
4. Parse `lib/recon.mjs` stdout (JSON) and surface to the operator: slug, nmap argv, port count, ports file path, transcript path.

## Output expectations

- `engagements/<slug>/ports.yml` exists with the parsed table (or `ports: []` if nothing was open).
- `engagements/<slug>/transcripts/recon-<ts>.json` exists with raw stdout/stderr, exit code, wall time.
- Operator summary lists the nmap command run and one line per open port (`<port>/<proto> <service> <version?>`).

## Do not

- Run nmap on the host.
- Edit `ports.yml` by hand. If the schema needs to change, update [lib/recon.mjs](../lib/recon.mjs) instead.
- Run anything intrusive — payloads, exploits, brute force. That's later phases (out of stage-1 scope).
