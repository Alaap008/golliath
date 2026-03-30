import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { consoleCapture } from '../browser/console.js';
import { safeResult } from '../utils/errors.js';

export function registerConsoleTools(server: McpServer): void {
  server.tool(
    'get_console_errors',
    'Return console errors (and optionally warnings) captured from the active page.',
    {
      limit: z.number().int().min(1).max(200).optional().describe('Max number of entries to return'),
      includeWarnings: z.boolean().optional().describe('Also include console warnings (default: false)'),
    },
    async ({ limit, includeWarnings }) => {
      return safeResult(async () => {
        const errors = consoleCapture.getErrors(limit);
        let results = [...errors];

        if (includeWarnings) {
          const warnings = consoleCapture.getEntries('warn', limit);
          results = [...results, ...warnings].sort((a, b) => a.timestamp - b.timestamp);
          if (limit) results = results.slice(-limit);
        }

        if (results.length === 0) {
          return 'No console errors captured.';
        }

        return JSON.stringify(results, null, 2);
      });
    },
  );
}
