# Patch mode

Triage a Windows host's installed-program inventory. The host is the target. The CSV produced by `lib/patch.mjs` lists every entry from the registry uninstall keys (HKLM both arches). Your job is to read that CSV, identify malware/CVE/remote-access concerns, and emit a `report.md` shaped exactly like the template at the end of this file.

Load `modes/_shared.md` first.

## Pipeline

1. The slash command runs `node lib/patch.mjs` which writes `installed_programs.csv` and a transcript, then prints JSON: `{ slug, csv_path, report_path, transcript_path, program_count, … }`.
2. `Read` the CSV at `csv_path`.
3. Classify every row into one of: malware/pirated suspects, CVE-flagged outdated software, remote-access/kernel-level, or a category bucket (games, audio, video, dev tools, utilities, microsoft-essential, microsoft-bulk, drivers/OEM, security, browsers).
4. `Write` `report.md` at `report_path` using the template verbatim. Replace every `<placeholder>` with concrete content. Keep the section headings and emojis exactly as written.

## Triage rules

**Malware / pirated indicators.** Flag a row when *any* hold:
- Publisher matches a known warez release-group convention (e.g. `RIDDICK`, `RELOADED`, `CODEX`, `PLAZA`, `FITGIRL`, `EMPRESS`, `SKIDROW`, `RAZOR1911`).
- DisplayName contains `MULTi[0-9]` / `REPACK` / `Cracked` / `Keygen`.
- Cryptic name with no Publisher, no Version, and no InstallDate (e.g. `XWB1_1P29 BDK32 Client Tools Registration`) — list as "investigate" rather than "confirmed malware".
- Legitimate-but-frequently-bundled-with-malware tools (Cheat Engine, JDownloader, soundboards distributed via shady mirrors). Flag with a "verify origin" note, not a "remove" note.

**CVE-flagged outdated software.** Only flag versions you are *confident* have a published CVE that affects them. Examples worth flagging when the version is old enough:
- `WinRAR < 6.23` → CVE-2023-38831 (actively exploited).
- `Microsoft Silverlight` → end-of-life Oct 2021, never patch again.
- `Java 8` / `JDK 19` (non-LTS, EOL).
- `Adobe After Effects 2020` / `Media Encoder 2020` (multiple 2020-era CVEs).
- `Microsoft Office Mondo 2016` when `Microsoft 365 Apps for enterprise` is also installed (redundant + CVE target).
- `Microsoft ASP.NET MVC 4 Runtime`, `Visual Studio Build Tools 2017` when 2022 is also present.
- Old `HandBrake`, `Audacity`, `IntelliJ IDEA Community 2022.x`, `MSI Afterburner < 4.6.6`.

Mirror cve.md's posture: **no hallucination**. If you don't know the CVE ID, write a plain-text risk description ("end-of-life, no further patches") instead of inventing one. CVE IDs you do name must apply to the version observed.

**Remote access / kernel-level.** Surface anything with remote-control or kernel-driver semantics so the operator can confirm intent: TeamViewer, AnyDesk, Riot Vanguard, Wazuh Agent, NVIDIA Telemetry Client. One bullet each, format `<Name> <Version> — <one-line reason>`.

## Category buckets

Categories are fixed (mirrors `planroom/results.md`):

- 🎮 Games & game launchers — launchers, games, game-related drivers/runtimes, VR, anti-cheat.
- 🎵 Creative software — audio — DAWs, audio drivers, plugins, soundboards.
- 🎬 Creative software — video / image — Adobe video stack, OBS, Cinema 4D, downloader/converter tools.
- 🛠️ Developer tools — languages/runtimes, IDEs, build/SCM, containers/VMs, databases, networking/security CLIs.
- 🧰 Utilities — file/system utilities, hardware tools, wallpaper/customization.
- 💼 Microsoft — essential / current — current Office/Edge/.NET/VC++ runtimes.
- 📦 Microsoft bulk / SDK clutter — old SDK fragments, .NET workload manifests, old VC++ runtimes.
- 🔧 Drivers / OEM — Intel, NVIDIA, Realtek, vendor-bundled drivers and remnants.
- 🛡️ Security — Malwarebytes, Wazuh, Defender add-ons.
- 🌐 Browsers — Chrome, Firefox, Edge, Mozilla maintenance service.

Within a category, collapse duplicates (`Vulkan Run Time Libraries 1.0.65.1 ×6`), call out cleanup tips inline, keep the paragraph scannable. If a category has no entries, write "None identified."

## Recommended cleanup order

Three to seven numbered steps, ordered by impact: malware/pirated first, then critical CVE updates, then redundant duplicates, then bloat. Reference the actual programs found, not hypothetical ones.

## Report template (write verbatim, replace `<…>` placeholders)

```markdown
# Patch report — <hostname>

- Scanned: <scan_timestamp_iso>
- Programs enumerated: <total_program_count>
- Source CSV: <csv_relative_path>
- Engagement: <engagement_slug>

---

## Highest priority — investigate / remove first

### ⚠️ Possible malware / pirated software (investigate)

| Program | Why it's flagged |
| ------- | ---------------- |
| <malware_program_name_1> — publisher <malware_publisher_1> | <malware_reason_1> |
| <malware_program_name_2> — publisher <malware_publisher_2> | <malware_reason_2> |

### 🚨 Critical: outdated software with known CVEs

| Program | Installed | Risk |
| ------- | --------- | ---- |
| <cve_program_name_1> <cve_program_version_1> | <cve_install_date_1> | <cve_id_or_summary_1> — <cve_risk_description_1> |
| <cve_program_name_2> <cve_program_version_2> | <cve_install_date_2> | <cve_id_or_summary_2> — <cve_risk_description_2> |

### 🔐 Remote access / kernel-level — confirm you still want these

- <remote_program_1> <remote_version_1> — <remote_reason_1>
- <remote_program_2> <remote_version_2> — <remote_reason_2>

---

## Full category breakdown

### 🎮 Games & game launchers
<games_breakdown_paragraph>

### 🎵 Creative software — audio
<audio_breakdown_paragraph>

### 🎬 Creative software — video / image
<video_breakdown_paragraph>

### 🛠️ Developer tools
<dev_tools_breakdown>

### 🧰 Utilities
<utilities_breakdown>

### 💼 Microsoft — essential / current
<microsoft_essential_breakdown>

### 📦 Microsoft bulk / SDK clutter
<microsoft_bulk_breakdown>

### 🔧 Drivers / OEM
<drivers_breakdown>

### 🛡️ Security
<security_breakdown>

### 🌐 Browsers
<browsers_breakdown>

---

## Recommended cleanup order

1. <cleanup_step_1>
2. <cleanup_step_2>
3. <cleanup_step_3>
```

## Do not

- Run `lib/patch.mjs` more than once per `/banadi-patch` invocation. Each run creates a new `<unix_ts>/` subdir; re-running clobbers nothing but produces orphan dirs.
- Invent CVE IDs. Plain-text risk descriptions are fine when the ID is unknown.
- Skip a category. Write "None identified." when empty so the report stays scannable.
- Edit the CSV. It's the raw artifact — leave it as-is for future runs to diff against.
