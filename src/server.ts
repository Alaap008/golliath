import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConnectionTools } from './tools/connection.tools.js';
import { registerNetworkTools } from './tools/network.tools.js';
import { registerDOMTools } from './tools/dom.tools.js';
import { registerConsoleTools } from './tools/console.tools.js';
import { registerStyleTools } from './tools/styles.tools.js';
import { registerLayoutTools } from './tools/layout.tools.js';
import { registerScreenshotTools } from './tools/screenshot.tools.js';
import { registerDebugTools } from './tools/debug.tools.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'brms',
    version: '0.1.0',
  });

  // Phase 1 — core browser inspection
  registerConnectionTools(server);
  registerNetworkTools(server);
  registerDOMTools(server);
  registerConsoleTools(server);

  // Phase 2 — styles, layout, screenshots
  registerStyleTools(server);
  registerLayoutTools(server);
  registerScreenshotTools(server);

  // Phase 3 — AI debugging layer
  registerDebugTools(server);

  return server;
}
