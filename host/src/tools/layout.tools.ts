import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge/native-messaging.js';
import { safeResult } from '../utils/errors.js';

export function registerLayoutTools(server: McpServer): void {
  server.tool(
    'get_layout_info',
    'Get bounding box, visibility, viewport status, overlap detection, parent clipping, and scroll context for elements matching a selector.',
    {
      selector: z.string().describe('CSS selector to query'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const result = await bridge.sendRequest('get_layout', { selector });
        return JSON.stringify(result.results ?? result, null, 2);
      });
    },
  );

  server.tool(
    'get_visible_elements',
    'Return all interactive elements currently visible in the viewport with accessibility info (role, aria-label, disabled state).',
    {},
    async () => {
      return safeResult(async () => {
        const result = await bridge.sendRequest('get_visible', {});
        return JSON.stringify(result.elements ?? result, null, 2);
      });
    },
  );
}
