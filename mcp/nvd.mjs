// nvd.* tools. Token-bucket rate-limited, on-disk cached, retry on
// 503/timeout up to 3 attempts. Fetches go through curl inside the banadi
// container (host stays clean).

import { fetchCve, searchByCpe, searchByKeyword } from './lib/nvd-client.mjs';
import { nvdCveInput, nvdSearchInput, nvdCvesForServiceInput } from './lib/schemas.mjs';

function ok(structured) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function err(message, extra = {}) {
  const payload = { error: message, ...extra };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function register(mcp) {
  mcp.registerTool(
    'nvd.cve',
    {
      description: 'Fetch a CVE record from NVD (cached). Returns the full vulnerabilities[0].cve object plus _cached/_fetched_at.',
      inputSchema: nvdCveInput,
    },
    async ({ id }) => {
      try {
        const r = await fetchCve(id.toUpperCase());
        return ok(r);
      } catch (e) {
        if (e.code === 'NVD_NOT_FOUND') return err(`not found: ${id}`, { status: 'not_found' });
        if (e.code === 'NVD_UNAVAILABLE') return err(e.message, { status: 'nvd_unavailable', attempts: e.attempts });
        return err(e.message);
      }
    }
  );

  mcp.registerTool(
    'nvd.search',
    {
      description: 'Search NVD by CPE. Returns trimmed { total, items: [{ id, summary, cvss, published }] }.',
      inputSchema: nvdSearchInput,
    },
    async ({ cpe, version }) => {
      try {
        const r = await searchByCpe(cpe, version);
        return ok(r);
      } catch (e) {
        if (e.code === 'NVD_UNAVAILABLE') return err(e.message, { status: 'nvd_unavailable', attempts: e.attempts });
        return err(e.message);
      }
    }
  );

  mcp.registerTool(
    'nvd.cves_for_service',
    {
      description: 'Keyword-search NVD for a service+version, optionally filtered by an OS substring in the description.',
      inputSchema: nvdCvesForServiceInput,
    },
    async ({ service, version, os }) => {
      try {
        const r = await searchByKeyword(service, version, os);
        return ok(r);
      } catch (e) {
        if (e.code === 'NVD_UNAVAILABLE') return err(e.message, { status: 'nvd_unavailable', attempts: e.attempts });
        return err(e.message);
      }
    }
  );
}
