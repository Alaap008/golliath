import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSnapshot, queryDOM } from '../browser/dom.js';
import { safeResult } from '../utils/errors.js';

export function registerDOMTools(server: McpServer): void {
  server.tool(
    'get_dom_tree',
    'Return the DOM tree structure of the active page. Optionally scope to a CSS selector and limit tree depth.',
    {
      selector: z.string().optional().describe('CSS selector to scope the tree (default: entire document)'),
      depth: z.number().int().min(1).max(20).optional().describe('Max tree depth (default: 10)'),
    },
    async ({ selector, depth }) => {
      return safeResult(async () => {
        const tree = await getSnapshot(selector, depth);
        return JSON.stringify(tree, null, 2);
      });
    },
  );

  server.tool(
    'query_dom',
    'Query the active page DOM using a CSS selector. Returns matching elements with tag, id, classes, text content, and attributes.',
    {
      selector: z.string().describe('CSS selector to query'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const elements = await queryDOM(selector);

        if (elements.length === 0) {
          return `No elements found matching selector: ${selector}`;
        }

        return JSON.stringify(elements, null, 2);
      });
    },
  );
}
