#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { log } from './utils/logger.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('BRMS MCP Server running on stdio');
}

main().catch((err) => {
  log.error('Fatal error:', err);
  process.exit(1);
});
