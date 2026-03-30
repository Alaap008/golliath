#!/usr/bin/env node

/**
 * BRMS Host entry point.
 *
 * - Starts an HTTP server on port 3100 exposing MCP via Streamable HTTP
 * - Starts the native messaging bridge to communicate with the Chrome extension
 */

import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { bridge } from './bridge/native-messaging.js';
import { log } from './utils/logger.js';

const PORT = parseInt(process.env.BRMS_PORT ?? '3100', 10);

async function main(): Promise<void> {
  bridge.start();

  const mcpServer = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname === '/mcp') {
      await transport.handleRequest(req, res);
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', extensionConnected: bridge.isConnected() }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await mcpServer.connect(transport);

  httpServer.listen(PORT, () => {
    log.info(`BRMS MCP server listening on http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  log.error('Fatal error:', err);
  process.exit(1);
});
