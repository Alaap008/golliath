#!/usr/bin/env node

/**
 * BRMS Host entry point.
 *
 * - Starts an HTTP server on port 3100 exposing MCP via Streamable HTTP
 * - Starts the native messaging bridge to communicate with the Chrome extension
 *
 * Each Cursor connection gets its own transport + MCP server instance so that
 * reconnects (which send a fresh `initialize`) never hit the "already initialized"
 * error that occurs when a single transport is reused across sessions.
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

process.on('exit', (code) => { debugLog(`Process exiting with code ${code}`); });
process.on('uncaughtException', (err) => { debugLog(`UNCAUGHT EXCEPTION: ${err.stack ?? err.message}`); });
process.on('unhandledRejection', (reason) => { debugLog(`UNHANDLED REJECTION: ${reason}`); });
process.on('SIGTERM', () => debugLog('Received SIGTERM'));
process.on('SIGINT', () => debugLog('Received SIGINT'));

// Keep process alive even if stdin closes (native messaging host mode)
process.stdin.on('end', () => { debugLog('stdin ended — keeping process alive'); });
process.stdin.resume();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
};

async function main(): Promise<void> {
  writeFileSync(DEBUG_LOG, `=== BRMS Host starting at ${new Date().toISOString()} ===\n`);
  debugLog(`PID: ${process.pid}, Node: ${process.version}`);

  bridge.start();
  debugLog('Bridge started');

  // Session map: sessionId → transport
  // Each Cursor connection gets its own transport so reconnects start fresh.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    // Attach CORS to every response
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    // ── /health ────────────────────────────────────────────────
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', extensionConnected: bridge.isConnected() }));
      return;
    }

    // ── /mcp ──────────────────────────────────────────────────
    if (url.pathname === '/mcp') {
      try {
        // Parse body once for POST requests
        let parsedBody: unknown;
        if (req.method === 'POST') {
          const raw = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            req.on('end', () => resolve(data));
            req.on('error', reject);
          });
          try {
            parsedBody = JSON.parse(raw);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
            return;
          }
        }

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (req.method === 'POST' && !sessionId) {
          // ── New session ────────────────────────────────────
          // Cursor is connecting (or reconnecting). Always create a fresh
          // transport so `initialize` succeeds even after a prior connection.
          const newId = randomUUID();

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newId,
          });

          transport.onclose = () => {
            sessions.delete(newId);
            debugLog(`Session closed: ${newId}`);
          };

          // Each session gets its own MCP server instance
          const mcpServer = createServer();
          await mcpServer.connect(transport);

          sessions.set(newId, transport);
          debugLog(`New MCP session: ${newId} (total: ${sessions.size})`);

          await transport.handleRequest(req, res, parsedBody);

        } else if (sessionId && sessions.has(sessionId)) {
          // ── Existing session ───────────────────────────────
          await sessions.get(sessionId)!.handleRequest(req, res, parsedBody);

        } else if (sessionId && !sessions.has(sessionId)) {
          // Unknown session — client should reconnect with a fresh initialize
          debugLog(`Unknown session ID: ${sessionId}`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found. Send a new initialize request without Mcp-Session-Id.' }));

        } else {
          // GET/DELETE without session ID
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mcp-Session-Id header required' }));
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

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      debugLog(`Port ${PORT} is already in use.`);
      console.error('');
      console.error(`  [brms] Error: port ${PORT} is already in use.`);
      console.error(`  A previous BRMS server may still be running.`);
      console.error(`  To free the port:`);
      console.error(`    macOS/Linux:  lsof -ti :${PORT} | xargs kill`);
      console.error(`    Windows:      netstat -ano | findstr :${PORT}  (then taskkill /PID <pid> /F)`);
      console.error('');
      process.exit(1);
    } else {
      debugLog(`HTTP server error: ${err.message}`);
    }
  });

  httpServer.listen(PORT, () => {
    debugLog(`HTTP server listening on :${PORT}`);
    console.log(`  [brms] MCP server running at http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  debugLog(`Fatal error in main: ${err.stack ?? err.message}`);
  process.exit(1);
});
