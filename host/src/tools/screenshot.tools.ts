import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge/native-messaging.js';
import { log } from '../utils/logger.js';

export function registerScreenshotTools(server: McpServer): void {
  server.tool(
    'capture_screenshot',
    'Capture a screenshot of the active page or a specific element. Optionally highlight the target element with a red border before capture.',
    {
      selector: z.string().optional().describe('CSS selector of element to screenshot (default: full page)'),
      highlight: z.boolean().optional().describe('Inject a temporary red border on the selector before capture (default: false)'),
      format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
      quality: z.number().int().min(1).max(100).optional().describe('JPEG quality 1-100 (only for jpeg format)'),
    },
    async ({ selector, highlight, format, quality }) => {
      try {
        if (highlight && selector) {
          await bridge.sendRequest('highlight_element', { selector });
        }

        const result = await bridge.sendRequest('screenshot', {
          selector,
          format: format ?? 'png',
          quality: quality ?? 80,
        });

        if (highlight && selector) {
          await bridge.sendRequest('remove_highlight', { selector }).catch(() => {});
        }

        const base64 = result.base64 as string;
        const mimeType = result.mimeType as string;

        return {
          content: [{
            type: 'image' as const,
            data: base64,
            mimeType,
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(message);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }] };
      }
    },
  );
}
