# banadi

AI-powered pentesting and vulnerability triage framework.

After recognizing LLM tooling through [pentagi](https://github.com/vxcontrol/pentagi) and Claude Code orchestration through [career-ops](https://github.com/santifer/career-ops), I created banadi. It combines Claude Code, Dockerized security tooling, CVE intelligence, and LLM-assisted analysis into a modular offensive security workflow.

---

## Commands

### `/banadi`
Displays the list of available commands.

### `/banadi-doctor`
Verifies Docker container, MCP servers, and LLM reachability are green.

![banadi-doctor demo](assets/photos/banadi-doctor.png)

### `/banadi-scope`
Prints current list of available targets in `config/scope.yml`.

![banadi-scope demo](assets/photos/banadi-scope.png)

### `/banadi-recon <target>`
Runs an nmap scan on the target in the Docker container. Logs ports, OS estimate, and transcript.

![banadi-recon demo](assets/photos/banadi-recon.png)

### `/banadi-vuln`
Sources [hackviser.com](https://hackviser.com/) for pentesting information/guidance per port.

![banadi-vuln demo](assets/photos/banadi-vuln.png)

> See [hackviser's document on port 22 (SSH)](https://hackviser.com/tactics/pentesting/services/ssh) for an example.

### `/banadi-cve`
Uses LLM reasoning/history to identify CVE IDs for the version banner and port service. Uses the NVD REST API to capture information and further guidance.

![banadi-cve demo](assets/photos/banadi-cve.png)

### `/banadi-patch`
Triages a Windows host's installed-program inventory. Uses LLM reasoning/history to identify CVE IDs, malware, and remote-access concerns, and generates a `report.md` from a template.

![banadi-patch demo](assets/photos/banadi-patch.png)

> `report.md` template. Results vary.

---

## Quick start

Prerequisites: Docker Desktop (or any Docker daemon) running, Node.js ≥ 20.6, and Claude Code.

```bash
cp config/scope.example.yml config/scope.yml   # edit your in-scope targets
npm install
bash scripts/banadi-up.sh                      # Linux/macOS/WSL: builds banadi/banadi:latest and starts the kali container
# Windows + Docker Desktop:
#   powershell -ExecutionPolicy Bypass -File scripts/banadi-up.ps1
claude
```

Then in Claude Code: `/banadi-doctor` (verifies the container is healthy), `/banadi-recon <target>`, `/banadi-vuln`, `/banadi-cve`.

## Architecture

- **Kali container** (`docker/banadi/Dockerfile`) — isolated environment for nmap, curl, and recon tooling. The host never runs scan tools directly.
- **MCP server** (`mcp/server.mjs`) — exposes typed tools to Claude Code: `banadi.{exec,curl,write_tmp,read_tmp}`, `nvd.{cve,search,cves_for_service}`, and `engagement://<slug>/{ports.yml,os.yml,scope.yml,transcripts/*}` resources. Wired in `.mcp.json`.
- **Phase library** (`lib/`) — pure-JS modules for recon, vuln-prep, CVE-prep, scope matching, engagement state. Imported by the MCP server and shelled out to by slash commands.
- **Slash commands** (`.claude/commands/`) and **prompt modes** (`modes/`) — operator-facing entrypoints that invoke the library + MCP tools.
- **Per-engagement state** (`engagements/<slug>/`) — `ports.yml`, `os.yml`, `scope.yml`, and JSON transcripts. Gitignored.
- **Per-port pipelines** (`pent/<port>.mjs`, `pent/<port>.cve.json`) — synthesized exploit/CVE plans. Gitignored.

See [planroom/PLAN.md](planroom/PLAN.md) for the canonical spec and [CLAUDE.md](CLAUDE.md) for runtime invariants.
