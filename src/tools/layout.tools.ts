import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { safeResult } from '../utils/errors.js';

export function registerLayoutTools(server: McpServer): void {
  server.tool(
    'get_layout_info',
    'Get bounding box, visibility, and viewport status for elements matching a selector.',
    {
      selector: z.string().describe('CSS selector to query'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const page = browserManager.getActivePage();

        const results = await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          return [...elements].map((el) => {
            const rect = el.getBoundingClientRect();
            const computed = window.getComputedStyle(el);
            const isVisible =
              computed.display !== 'none' &&
              computed.visibility !== 'hidden' &&
              parseFloat(computed.opacity) > 0 &&
              rect.width > 0 &&
              rect.height > 0;

            const isInViewport =
              rect.top < window.innerHeight &&
              rect.bottom > 0 &&
              rect.left < window.innerWidth &&
              rect.right > 0;

            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              isVisible,
              isInViewport,
            };
          });
        }, selector);

        return JSON.stringify(results, null, 2);
      });
    },
  );

  server.tool(
    'get_visible_elements',
    'Return all interactive elements currently visible in the viewport (buttons, links, inputs, etc.).',
    {},
    async () => {
      return safeResult(async () => {
        const page = browserManager.getActivePage();

        const results = await page.evaluate(() => {
          const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [onclick], [tabindex]';
          const elements = document.querySelectorAll(interactiveSelectors);

          return [...elements]
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const computed = window.getComputedStyle(el);
              const isVisible =
                computed.display !== 'none' &&
                computed.visibility !== 'hidden' &&
                parseFloat(computed.opacity) > 0 &&
                rect.width > 0 &&
                rect.height > 0;

              const isInViewport =
                rect.top < window.innerHeight &&
                rect.bottom > 0 &&
                rect.left < window.innerWidth &&
                rect.right > 0;

              if (!isVisible || !isInViewport) return null;

              return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                classes: [...el.classList],
                text: (el.textContent || '').trim().slice(0, 100),
                type: el.getAttribute('type') || '',
                href: el.getAttribute('href') || '',
                boundingBox: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
              };
            })
            .filter(Boolean);
        });

        return JSON.stringify(results, null, 2);
      });
    },
  );
}
