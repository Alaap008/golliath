import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge/native-messaging.js';
import { networkMonitor } from '../browser/network.js';
import { consoleCapture } from '../browser/console.js';
import { safeResult } from '../utils/errors.js';
import type { DebugCheck, DebugIssue, Severity, CorrelationResult } from '../types/index.js';

export function registerDebugTools(server: McpServer): void {
  // ───────────────────────────────────────────────
  // debug_element
  // ───────────────────────────────────────────────
  server.tool(
    'debug_element',
    'Comprehensive diagnosis of why an element may not be clickable, visible, or behaving as expected. Checks the element and its entire ancestor chain for CSS issues, overlaps, disabled state, stacking context, and clickability.',
    {
      selector: z.string().describe('CSS selector of the element to debug'),
    },
    async ({ selector }) => {
      return safeResult(async () => {
        const analysis = await bridge.sendRequest('debug_element', { selector }) as Record<string, unknown>;

        if (!analysis.found) {
          const result: DebugIssue = { issue: 'Element not found', reasons: [`No element matches selector: ${selector}`], confidence: 1.0 };
          return JSON.stringify(result);
        }

        const failedChecks = (analysis.checks as DebugCheck[]).filter((c) => !c.passed);
        const diagnosis: DebugIssue = {
          issue: failedChecks.length > 0 ? failedChecks[0].detail : 'No obvious issues detected',
          reasons: failedChecks.map((c) => c.detail),
          confidence: failedChecks.length > 0 ? Math.min(0.95, 0.7 + failedChecks.length * 0.05) : 0.4,
        };

        return JSON.stringify({ ...analysis, diagnosis }, null, 2);
      });
    },
  );

  // ───────────────────────────────────────────────
  // diagnose_network
  // ───────────────────────────────────────────────
  server.tool(
    'diagnose_network',
    'Diagnose network issues: failed requests, slow responses, CORS problems, rate limiting, and error body parsing. Groups failures by domain.',
    {
      urlPattern: z.string().optional().describe('Regex pattern to filter by URL'),
    },
    async ({ urlPattern }) => {
      return safeResult(async () => {
        const entries = networkMonitor.getEntries({ urlPattern });
        const consoleErrors = consoleCapture.getErrors();

        const durations = entries.map((e) => e.timing.duration).filter((d) => d > 0).sort((a, b) => a - b);
        const p95Index = Math.floor(durations.length * 0.95);
        const p95 = durations[p95Index] ?? 0;

        const timingBuckets = { fast: 0, normal: 0, slow: 0, verySlow: 0 };
        for (const d of durations) {
          if (d < 200) timingBuckets.fast++;
          else if (d < 1000) timingBuckets.normal++;
          else if (d < 3000) timingBuckets.slow++;
          else timingBuckets.verySlow++;
        }

        const failedRequests = entries
          .filter((e) => e.status !== null && e.status >= 400)
          .map((e) => {
            let errorBody: string | null = null;
            if (e.responseBody) {
              try {
                const parsed = JSON.parse(e.responseBody);
                errorBody = parsed.message || parsed.error || parsed.detail || e.responseBody.slice(0, 500);
              } catch {
                errorBody = e.responseBody.slice(0, 500);
              }
            }
            return { url: e.url, status: e.status, method: e.method, errorBody };
          });

        const corsIssues = entries
          .filter((e) => e.status === null && !e.resourceType.match(/^(image|stylesheet|font|media)$/i))
          .map((e) => ({ url: e.url, method: e.method }));

        const rateLimited = entries
          .filter((e) => e.status === 429)
          .map((e) => {
            let domain = '';
            try { domain = new URL(e.url).hostname; } catch {}
            return { url: e.url, domain };
          });

        const failuresByDomain: Record<string, number> = {};
        for (const f of failedRequests) {
          try {
            const domain = new URL(f.url).hostname;
            failuresByDomain[domain] = (failuresByDomain[domain] || 0) + 1;
          } catch {}
        }

        const parts: string[] = [];
        parts.push(`${entries.length} total requests captured`);
        if (failedRequests.length > 0) parts.push(`${failedRequests.length} failed (4xx/5xx)`);
        if (corsIssues.length > 0) parts.push(`${corsIssues.length} possible CORS issues`);
        if (rateLimited.length > 0) parts.push(`${rateLimited.length} rate-limited (429)`);
        if (timingBuckets.verySlow > 0) parts.push(`${timingBuckets.verySlow} very slow requests (>3s)`);
        if (p95 > 1000) parts.push(`P95 response time: ${Math.round(p95)}ms`);
        if (failedRequests.length === 0 && corsIssues.length === 0) parts.push('No issues detected');

        const diagnosis = {
          totalRequests: entries.length,
          timingBuckets,
          p95ResponseTime: Math.round(p95),
          failedRequests: failedRequests.slice(-30),
          corsIssues: corsIssues.slice(-10),
          rateLimited: rateLimited.slice(-10),
          failuresByDomain,
          relatedConsoleErrors: consoleErrors.slice(-10).map((e) => e.text),
          summary: parts.join('. ') + '.',
        };

        return JSON.stringify(diagnosis, null, 2);
      });
    },
  );

  // ───────────────────────────────────────────────
  // correlate_issues
  // ───────────────────────────────────────────────
  server.tool(
    'correlate_issues',
    'Cross-reference network errors, console errors, and DOM state. Detects broken resources, auth failure chains, repeated errors, and ranks by severity.',
    {},
    async () => {
      return safeResult(async () => {
        const allNetworkEntries = networkMonitor.getEntries();
        const networkErrors = allNetworkEntries.filter((e) => e.status !== null && e.status >= 400);
        const consoleErrors = consoleCapture.getErrors(100);
        const allConsole = consoleCapture.getEntries(undefined, 200);

        const correlations: CorrelationResult[] = [];

        // 1. Network <-> Console: URL pathname matching
        for (const netErr of networkErrors.slice(-30)) {
          let pathname = '';
          try { pathname = new URL(netErr.url).pathname; } catch { continue; }
          const related = consoleErrors.filter((ce) => ce.text.includes(pathname));
          if (related.length > 0) {
            correlations.push({
              domain: 'network <-> console',
              severity: netErr.status! >= 500 ? 'critical' : 'warning',
              details: `Failed ${netErr.method} ${netErr.url} (${netErr.status}) has ${related.length} related console error(s)`,
              evidence: related.slice(0, 3).map((r) => r.text.slice(0, 200)),
            });
          }
        }

        // 2. Network -> DOM: broken images, failed scripts/stylesheets
        const brokenResources = allNetworkEntries.filter(
          (e) => (e.status !== null && e.status >= 400) &&
                 ['script', 'stylesheet', 'image'].includes(e.resourceType),
        );
        for (const res of brokenResources.slice(-10)) {
          let severity: Severity = 'warning';
          if (res.resourceType === 'script') severity = 'critical';

          correlations.push({
            domain: 'network -> DOM',
            severity,
            details: `Broken ${res.resourceType}: ${res.url} (${res.status})`,
            evidence: [`Resource type: ${res.resourceType}`, `Status: ${res.status}`],
          });
        }

        // 3. Console -> DOM: check if element IDs from console errors exist
        const errorTexts = consoleErrors.slice(-20).map((e) => e.text);
        const domCorrelations = await bridge.sendRequest('correlate_dom_check', { errors: errorTexts });
        const domResults = (domCorrelations.results ?? []) as Array<{ error: string; selector: string; exists: boolean }>;

        for (const dc of domResults) {
          correlations.push({
            domain: 'console -> DOM',
            severity: dc.exists ? 'info' : 'warning',
            details: `Console error references ${dc.selector} (${dc.exists ? 'element exists' : 'element NOT found'})`,
            evidence: [dc.error],
          });
        }

        // 4. Auth failure chains (401 -> redirect pattern)
        const authFailures = networkErrors.filter((e) => e.status === 401 || e.status === 403);
        if (authFailures.length > 0) {
          const redirectsAfter = allNetworkEntries.filter(
            (e) => (e.status === 302 || e.status === 301) &&
                   e.timestamp > authFailures[0].timestamp,
          );
          correlations.push({
            domain: 'auth chain',
            severity: 'critical',
            details: `${authFailures.length} auth failure(s) (401/403)${redirectsAfter.length > 0 ? ` followed by ${redirectsAfter.length} redirect(s)` : ''}`,
            evidence: authFailures.slice(0, 5).map((a) => `${a.method} ${a.url} -> ${a.status}`),
          });
        }

        // 5. Repeated errors
        const errorCounts: Record<string, number> = {};
        for (const ce of consoleErrors) {
          const key = ce.text.slice(0, 100);
          errorCounts[key] = (errorCounts[key] || 0) + 1;
        }
        const repeated = Object.entries(errorCounts).filter(([, count]) => count >= 3);
        for (const [text, count] of repeated) {
          correlations.push({
            domain: 'repeated errors',
            severity: 'warning',
            details: `Console error repeated ${count} times`,
            evidence: [text],
          });
        }

        // 6. Timeline (last 30 events chronologically)
        const timeline = [
          ...allNetworkEntries.slice(-15).map((e) => ({
            type: 'network' as const,
            time: e.timestamp,
            summary: `${e.method} ${e.url.slice(0, 80)} -> ${e.status ?? 'aborted'}`,
          })),
          ...allConsole.slice(-15).map((e) => ({
            type: 'console' as const,
            time: e.timestamp,
            summary: `[${e.level}] ${e.text.slice(0, 100)}`,
          })),
        ].sort((a, b) => a.time - b.time);

        const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
        correlations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        const critical = correlations.filter((c) => c.severity === 'critical').length;
        const warning = correlations.filter((c) => c.severity === 'warning').length;

        return JSON.stringify({
          networkErrors: networkErrors.length,
          consoleErrors: consoleErrors.length,
          correlations,
          timeline: timeline.slice(-30),
          summary: correlations.length > 0
            ? `Found ${correlations.length} correlation(s): ${critical} critical, ${warning} warning, ${correlations.length - critical - warning} info`
            : 'No cross-domain correlations found',
        }, null, 2);
      });
    },
  );
}
