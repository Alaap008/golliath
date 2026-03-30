import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { networkMonitor } from '../browser/network.js';
import { safeResult } from '../utils/errors.js';

export function registerNetworkTools(server: McpServer): void {
  server.tool(
    'get_network_calls',
    'Return captured network requests from the active page. Supports filtering by URL pattern, status code, and resource type.',
    {
      urlPattern: z.string().optional().describe('Regex pattern to filter by URL'),
      statusCode: z.number().int().optional().describe('Filter by exact HTTP status code'),
      resourceType: z.string().optional().describe('Filter by resource type (xhr, fetch, document, stylesheet, image, script, etc.)'),
      limit: z.number().int().min(1).max(100).optional().describe('Max number of entries to return (default: all, max 100)'),
    },
    async ({ urlPattern, statusCode, resourceType, limit }) => {
      return safeResult(async () => {
        const entries = networkMonitor.getEntries({ urlPattern, statusCode, resourceType, limit });

        if (entries.length === 0) {
          return 'No network calls captured yet. Browse some pages first, then try again.';
        }

        const summary = entries.map((e) => ({
          url: e.url,
          method: e.method,
          status: e.status,
          resourceType: e.resourceType,
          timing: e.timing,
          requestBody: e.requestBody,
          responseBody: e.responseBody?.slice(0, 2000) ?? null,
        }));

        return JSON.stringify(summary, null, 2);
      });
    },
  );
}
