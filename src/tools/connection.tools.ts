import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { networkMonitor } from '../browser/network.js';
import { consoleCapture } from '../browser/console.js';
import { safeResult } from '../utils/errors.js';

export function registerConnectionTools(server: McpServer): void {
  server.tool(
    'connect_browser',
    'Connect to a running Chrome instance via Chrome DevTools Protocol (CDP). Chrome must be launched with --remote-debugging-port.',
    { endpoint: z.string().optional().describe('CDP endpoint URL (default: http://localhost:9222)') },
    async ({ endpoint }) => {
      return safeResult(async () => {
        const pages = await browserManager.connect(endpoint);

        if (pages.length > 0) {
          const page = browserManager.getActivePage();
          networkMonitor.attach(page);
          consoleCapture.attach(page);
        }

        return JSON.stringify({ connected: true, pages }, null, 2);
      });
    },
  );

  server.tool(
    'list_pages',
    'List all open tabs/pages in the connected browser.',
    {},
    async () => {
      return safeResult(async () => {
        const pages = await browserManager.getPages();
        return JSON.stringify(pages, null, 2);
      });
    },
  );

  server.tool(
    'select_page',
    'Select an open browser tab by index for subsequent inspection. Attaches network and console monitors to the selected page.',
    { index: z.number().int().min(0).describe('Zero-based index of the page to select') },
    async ({ index }) => {
      return safeResult(async () => {
        const info = await browserManager.selectPage(index);
        const page = browserManager.getActivePage();
        networkMonitor.attach(page);
        consoleCapture.attach(page);
        return JSON.stringify(info, null, 2);
      });
    },
  );
}
