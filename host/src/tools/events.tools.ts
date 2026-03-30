import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge/native-messaging.js';
import { safeResult } from '../utils/errors.js';

export function registerEventTools(server: McpServer): void {
  server.tool(
    'get_event_listeners',
    'Get event listeners attached to elements matching a selector via Chrome DevTools Protocol. Returns event type, handler source preview, and listener options.',
    {
      selector: z.string().describe('CSS selector to query'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const result = await bridge.sendRequest('get_event_listeners', { selector });
        const results = result.results as Array<Record<string, unknown>>;

        if (!results || results.length === 0) {
          return `No elements found for selector: ${selector}`;
        }

        return JSON.stringify(results, null, 2);
      });
    },
  );
}
