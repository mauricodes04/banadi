#!/usr/bin/env node
// banadi MCP server. Combined surface:
//   banadi.{exec,curl,write_tmp,read_tmp}
//   nvd.{cve,search,cves_for_service}
//   engagement://<slug>/{ports.yml,os.yml,scope.yml,transcripts/*}
//
// Stdio transport. Spawned by Claude Code from .mcp.json.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { register as registerBanadi } from './banadi.mjs';
import { register as registerEngagement } from './engagement.mjs';
import { register as registerNvd } from './nvd.mjs';
import { log } from '../lib/util/log.mjs';

const mcp = new McpServer(
  { name: 'banadi', version: '0.2.0' },
  {
    capabilities: {
      tools: {},
      resources: { listChanged: true, subscribe: true },
    },
  }
);

registerBanadi(mcp);
registerNvd(mcp);
registerEngagement(mcp);

const transport = new StdioServerTransport();
await mcp.connect(transport);
log.info('banadi mcp server ready');
