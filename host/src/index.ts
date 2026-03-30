#!/usr/bin/env node

/**
 * BRMS Host entry point.
 *
 * - Starts an HTTP server on port 3100 exposing MCP via Streamable HTTP
 * - Starts the native messaging bridge to communicate with the Chrome extension
 */

import { createServer as createHttpServer } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { bridge } from './bridge/native-messaging.js';
import { log } from './utils/logger.js';

const PORT = parseInt(process.env.BRMS_PORT ?? '3100', 10);
const DEBUG_LOG = '/tmp/brms-host-debug.log';

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch {}
  log.info(msg);
}

// Catch everything that might kill the process
process.on('exit', (code) => {
  debugLog(`Process exiting with code ${code}`);
});
process.on('uncaughtException', (err) => {
  debugLog(`UNCAUGHT EXCEPTION: ${err.stack ?? err.message}`);
});
process.on('unhandledRejection', (reason) => {
  debugLog(`UNHANDLED REJECTION: ${reason}`);
});
process.on('SIGTERM', () => debugLog('Received SIGTERM'));
process.on('SIGINT', () => debugLog('Received SIGINT'));

// Keep process alive even if stdin closes
process.stdin.on('end', () => {
  debugLog('stdin ended — keeping process alive');
});
process.stdin.resume();

async function main(): Promise<void> {
  writeFileSync(DEBUG_LOG, `=== BRMS Host starting at ${new Date().toISOString()} ===\n`);
  debugLog(`PID: ${process.pid}, Node: ${process.version}`);
  debugLog(`stdin isTTY: ${process.stdin.isTTY}, stdout isTTY: ${process.stdout.isTTY}`);

  bridge.start();
  debugLog('Bridge started');

  const mcpServer = createServer();
  debugLog('MCP server created');

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname === '/mcp') {
      try {
        // Parse body for POST requests before passing to transport
        if (req.method === 'POST') {
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            req.on('end', () => resolve(data));
            req.on('error', reject);
          });
          const parsedBody = JSON.parse(body);
          await transport.handleRequest(req, res, parsedBody);
        } else {
          await transport.handleRequest(req, res);
        }
      } catch (err) {
        debugLog(`MCP request error: ${err instanceof Error ? err.stack : err}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
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
  debugLog('MCP connected to transport');

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      debugLog(`Port ${PORT} in use, retrying in 1s...`);
      setTimeout(() => {
        httpServer.close();
        httpServer.listen(PORT);
      }, 1000);
    } else {
      debugLog(`HTTP server error: ${err.message}`);
    }
  });

  httpServer.listen(PORT, () => {
    debugLog(`HTTP server listening on :${PORT}`);
  });
}

main().catch((err) => {
  debugLog(`Fatal error in main: ${err.stack ?? err.message}`);
  process.exit(1);
});
