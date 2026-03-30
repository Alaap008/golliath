import { log } from './logger.js';

export class BRMSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'BRMSError';
  }
}

export function notConnected(): BRMSError {
  return new BRMSError(
    'Not connected to a browser. Call connect_browser first.',
    'NOT_CONNECTED',
  );
}

export function noActivePage(): BRMSError {
  return new BRMSError(
    'No active page selected. Call select_page first.',
    'NO_ACTIVE_PAGE',
  );
}

/**
 * Wraps a tool handler so MCP errors are returned as structured text
 * instead of crashing the server.
 */
export function safeResult(fn: () => Promise<string>): Promise<{ content: { type: 'text'; text: string }[] }> {
  return fn()
    .then((text) => ({ content: [{ type: 'text' as const, text }] }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(message);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }] };
    });
}
