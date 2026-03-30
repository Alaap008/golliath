import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { safeResult } from '../utils/errors.js';

const KEY_STYLES = [
  'display',
  'position',
  'visibility',
  'opacity',
  'zIndex',
  'pointerEvents',
  'overflow',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
] as const;

export function registerStyleTools(server: McpServer): void {
  server.tool(
    'get_computed_styles',
    'Get computed CSS styles for elements matching a selector. Returns key layout/visibility properties.',
    {
      selector: z.string().describe('CSS selector to query'),
      properties: z.array(z.string()).optional().describe('Specific CSS properties to return (default: key layout properties)'),
    },
    async ({ selector, properties }) => {
      return safeResult(async () => {
        const page = browserManager.getActivePage();
        const props = properties ?? [...KEY_STYLES];

        const results = await page.evaluate(
          ({ sel, keys }) => {
            const elements = document.querySelectorAll(sel);
            return [...elements].map((el) => {
              const computed = window.getComputedStyle(el);
              const styles: Record<string, string> = {};
              for (const key of keys) {
                styles[key] = computed.getPropertyValue(key) || (computed as any)[key] || '';
              }
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                selector: sel,
                styles,
              };
            });
          },
          { sel: selector, keys: props },
        );

        return JSON.stringify(results, null, 2);
      });
    },
  );
}
