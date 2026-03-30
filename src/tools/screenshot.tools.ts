import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { safeResult } from '../utils/errors.js';

export function registerScreenshotTools(server: McpServer): void {
  server.tool(
    'capture_screenshot',
    'Capture a screenshot of the active page or a specific element. Returns base64-encoded PNG.',
    {
      selector: z.string().optional().describe('CSS selector of element to screenshot (default: full page)'),
      fullPage: z.boolean().optional().describe('Capture full scrollable page (default: false)'),
    },
    async ({ selector, fullPage }) => {
      return safeResult(async () => {
        const page = browserManager.getActivePage();
        let buffer: Buffer;

        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return `No element found for selector: ${selector}`;
          }
          buffer = await element.screenshot({ type: 'png' });
        } else {
          buffer = await page.screenshot({ type: 'png', fullPage: fullPage ?? false });
        }

        const base64 = buffer.toString('base64');
        return JSON.stringify({
          format: 'png',
          encoding: 'base64',
          size: buffer.length,
          data: base64,
        });
      });
    },
  );
}
