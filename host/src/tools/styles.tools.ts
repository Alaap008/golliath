import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge/native-messaging.js';
import { safeResult } from '../utils/errors.js';

export function registerStyleTools(server: McpServer): void {
  server.tool(
    'get_computed_styles',
    'Get computed CSS styles for elements matching a selector. Optionally includes ancestor chain styles (for debugging clipping/stacking) and pseudo-element styles.',
    {
      selector: z.string().describe('CSS selector to query'),
      properties: z.array(z.string()).optional().describe('Specific CSS properties to return (default: key layout properties)'),
      includeAncestors: z.boolean().optional().describe('Include overflow/position/zIndex/display of each ancestor up to body (default: false)'),
      includePseudo: z.boolean().optional().describe('Include ::before and ::after pseudo-element styles (default: false)'),
    },
    async ({ selector, properties, includeAncestors, includePseudo }) => {
      return safeResult(async () => {
        const result = await bridge.sendRequest('get_styles', {
          selector,
          properties,
          includeAncestors: includeAncestors ?? false,
          includePseudo: includePseudo ?? false,
        });

        return JSON.stringify(result.results ?? result, null, 2);
      });
    },
  );
}
