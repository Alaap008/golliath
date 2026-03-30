import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { browserManager } from '../browser/connection.js';
import { networkMonitor } from '../browser/network.js';
import { consoleCapture } from '../browser/console.js';
import { safeResult } from '../utils/errors.js';
import type { DebugIssue } from '../types/index.js';

export function registerDebugTools(server: McpServer): void {
  server.tool(
    'debug_element',
    'Diagnose why an element may not be clickable, visible, or behaving as expected. Checks CSS, layout, overlaps, and pointer-events.',
    {
      selector: z.string().describe('CSS selector of the element to debug'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const page = browserManager.getActivePage();

        const analysis = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { found: false, issues: [] as string[] };

          const rect = el.getBoundingClientRect();
          const computed = window.getComputedStyle(el);
          const issues: string[] = [];

          if (computed.display === 'none') issues.push('Element has display: none');
          if (computed.visibility === 'hidden') issues.push('Element has visibility: hidden');
          if (parseFloat(computed.opacity) === 0) issues.push('Element has opacity: 0');
          if (computed.pointerEvents === 'none') issues.push('Element has pointer-events: none');
          if (rect.width === 0 || rect.height === 0) issues.push('Element has zero dimensions');

          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const topEl = document.elementFromPoint(centerX, centerY);
          if (topEl && topEl !== el && !el.contains(topEl)) {
            issues.push(`Covered by another element: <${topEl.tagName.toLowerCase()}${topEl.id ? '#' + topEl.id : ''}>`);
          }

          const isInViewport =
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0;
          if (!isInViewport) issues.push('Element is outside the viewport');

          return {
            found: true,
            tag: el.tagName.toLowerCase(),
            id: el.id,
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles: {
              display: computed.display,
              visibility: computed.visibility,
              opacity: computed.opacity,
              pointerEvents: computed.pointerEvents,
              position: computed.position,
              zIndex: computed.zIndex,
              overflow: computed.overflow,
            },
            issues,
          };
        }, selector);

        if (!analysis.found) {
          return JSON.stringify({ issue: 'Element not found', reasons: [`No element matches selector: ${selector}`], confidence: 1.0 } satisfies DebugIssue);
        }

        const result: DebugIssue = {
          issue: analysis.issues.length > 0 ? analysis.issues[0] : 'No obvious issues detected',
          reasons: analysis.issues.length > 0 ? analysis.issues : ['Element appears interactive and visible'],
          confidence: analysis.issues.length > 0 ? 0.85 : 0.5,
        };

        return JSON.stringify({ ...analysis, diagnosis: result }, null, 2);
      });
    },
  );

  server.tool(
    'diagnose_network',
    'Diagnose network issues: failed requests, slow responses, error status codes. Correlates with console errors.',
    {
      urlPattern: z.string().optional().describe('Regex pattern to filter by URL'),
    },
    async ({ urlPattern }) => {
      return safeResult(async () => {
        const entries = networkMonitor.getEntries({ urlPattern });
        const errors = consoleCapture.getErrors();

        const failedRequests = entries.filter((e) => e.status !== null && e.status >= 400);
        const nullStatus = entries.filter((e) => e.status === null);

        const diagnosis = {
          totalRequests: entries.length,
          failedRequests: failedRequests.map((e) => ({
            url: e.url,
            status: e.status,
            method: e.method,
          })),
          abortedRequests: nullStatus.map((e) => ({
            url: e.url,
            method: e.method,
          })),
          relatedConsoleErrors: errors.slice(-10).map((e) => e.text),
          summary: '',
        };

        if (failedRequests.length === 0 && nullStatus.length === 0) {
          diagnosis.summary = 'No failed network requests detected.';
        } else {
          diagnosis.summary = `Found ${failedRequests.length} failed and ${nullStatus.length} aborted requests.`;
        }

        return JSON.stringify(diagnosis, null, 2);
      });
    },
  );

  server.tool(
    'correlate_issues',
    'Cross-reference network errors, console errors, and DOM state to find related issues.',
    {},
    async () => {
      return safeResult(async () => {
        const networkErrors = networkMonitor.getEntries().filter((e) => e.status !== null && e.status >= 400);
        const consoleErrors = consoleCapture.getErrors(50);

        const correlations: Array<{ domain: string; details: string }> = [];

        for (const netErr of networkErrors.slice(-20)) {
          const related = consoleErrors.filter((ce) => ce.text.includes(new URL(netErr.url).pathname));
          if (related.length > 0) {
            correlations.push({
              domain: 'network <-> console',
              details: `Failed ${netErr.method} ${netErr.url} (${netErr.status}) has ${related.length} related console error(s)`,
            });
          }
        }

        return JSON.stringify({
          networkErrors: networkErrors.length,
          consoleErrors: consoleErrors.length,
          correlations,
          summary: correlations.length > 0
            ? `Found ${correlations.length} cross-domain correlation(s)`
            : 'No obvious correlations found between network and console errors',
        }, null, 2);
      });
    },
  );
}
