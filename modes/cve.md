# CVE mode (stage 3)

For each open port, identify CVEs tied to the exact nmap version banner + target OS, verify each via the NVD API, and write `pent/<port>.cve.json`.

Load `modes/_shared.md` first.

## Pipeline

1. Run `node lib/cve.mjs <slug> [--force]`. Parse the stdout JSON.
2. The JSON contains:
   - `generate[]` — ports needing a fresh `pent/<port>.cve.json`. Each entry has `port, protocol, service, version, os, os_family, pent_path, cve_path, overwrite`.
   - `exists[]` — ports with an existing `.cve.json` (kept unless `--force`).
  - `skipped[]` — ports with no `pent/<port>.mjs` yet (run `/banadi-vuln` first).
   - `os` — parsed OS from `os.yml` (may be null if OS detection failed).
3. For each entry in `generate[]`, in order:
   a. **Read** `pent_path` (the `.mjs`) to get the confirmed version banner and service context.
   b. **Reason** (LLM step): identify candidate CVE IDs for this service + version + OS from training knowledge. List them with a one-line rationale. Be conservative — only name CVEs you are confident apply to this exact version range. Do not invent IDs.
   c. **Verify** each candidate via the `nvd.cve` MCP tool (cached, rate-limited, retry-aware):
      ```
      mcp__banadi__nvd.cve { "id": "<CVE-ID>" }
      ```
      Result is the trimmed `cve` object plus `_cached`/`_fetched_at`. On `status: "not_found"`, drop the candidate. On `status: "nvd_unavailable"`, log it under **NVD failures** and move on.
   d. **Write** `cve_path` using the shape below.
4. Surface to the operator: created, kept, skipped (with reasons), any NVD fetch failures.

## `pent/<port>.cve.json` shape (strict)

```json
{
  "port": 22,
  "protocol": "tcp",
  "service": "ssh",
  "version": "OpenSSH 6.6.1p1 Ubuntu 2ubuntu2.13 (Ubuntu Linux; protocol 2.0)",
  "os": "Ubuntu 14.04",
  "os_family": "Linux",
  "generated": "2026-04-28T12:00:00.000Z",
  "cves": [
    {
      "id": "CVE-2016-0777",
      "description": "One-paragraph description from the NVD record.",
      "cvss_v3": 6.5,
      "cvss_v2": 4.3,
      "attack_vector": "Network",
      "fixed_in": "OpenSSH 7.1p2",
      "references": ["https://nvd.nist.gov/vuln/detail/CVE-2016-0777"],
      "stage4_hint": "Disable roaming on client: ssh -o UseRoaming=no user@<target>"
    }
  ]
}
```

Field rules:
- `cvss_v3` / `cvss_v2`: base score from the NVD record. Use `null` if not present.
- `attack_vector`: the CVSS `attackVector` value (`Network`, `Adjacent`, `Local`, `Physical`).
- `fixed_in`: the version that patched the CVE. Pull from the NVD CPE match list or the advisory. Use `null` if unknown.
- `stage4_hint`: one-line concrete probe or mitigation command. Use `<target>` placeholder. Must come from the CVE advisory or hackviser — do not invent. Use `null` if no actionable command is available.
- `cves` may be `[]` if no confirmed CVEs were found — this is correct and expected for well-patched software.

## CVE reasoning rules

- **Version precision.** Only include a CVE if the nmap version banner falls within the CVE's affected range. e.g. `OpenSSH 6.6.1p1` is before `7.1p2`, so `CVE-2016-0777` (fixed in 7.1p2) applies. `CVE-2021-28041` (affects 8.2 only) does not.
- **OS context.** Some CVEs are OS-distribution patches (e.g. Ubuntu's backport of a fix). Use `os_family` to inform whether distro-specific CVEs apply.
- **Verify before listing.** If the NVD API returns 404 or the CVE body shows an unrelated product, drop it. The `cves[]` array must only contain verified, applicable CVEs.
- **No hallucination.** If you cannot name any CVEs with confidence for a given banner, write `"cves": []`. A truthful empty list is better than fabricated findings.
- **NVD rate limit.** Handled server-side by the `nvd.cve` token bucket (5 capacity, 1 token / 6s). Issue calls back-to-back; the bucket queues. Only fall back to raw `banadi.curl` against `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=…` if the MCP tool is unavailable.

## `nvd.cve` response shape

The tool returns the NVD `cve` object directly with `_cached` and `_fetched_at` markers. Key fields: `descriptions[].value` (English description), `metrics.cvssMetricV31[0].cvssData.baseScore` (CVSS v3), `metrics.cvssMetricV2[0].cvssData.baseScore` (CVSS v2), `weaknesses`, `references[].url`. For broader keyword/CPE searches, use `nvd.search` or `nvd.cves_for_service`.

## Do not

- Write CVEs that were not verified against the NVD API.
- Write stage4 commands you didn't draw from an advisory or hackviser. Use `null` if unsure.
- Fetch NVD for more than ~10 candidate CVEs per port — if you have that many candidates, rank and pick the most impactful.
- Overwrite existing `.cve.json` files unless `--force` was passed.
