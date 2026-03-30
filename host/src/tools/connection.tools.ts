import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { networkMonitor } from '../browser/network.js';
import { consoleCapture } from '../browser/console.js';
import { safeResult } from '../utils/errors.js';

export function registerConnectionTools(server: McpServer): void {
  server.tool(
    'connect_browser',
    'Connect to the browser via the BRMS Chrome Extension. The extension must be installed and active.',
    {},
    async () => {
      return safeResult(async () => {
        const pages = await browserManager.connect();

        networkMonitor.attach();
        consoleCapture.attach();

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
    'Select an open browser tab by index for subsequent inspection.',
    { index: z.number().int().min(0).describe('Zero-based index of the page to select') },
    async ({ index }) => {
      return safeResult(async () => {
        const info = await browserManager.selectPage(index);
        return JSON.stringify(info, null, 2);
      });
    },
  );
}
