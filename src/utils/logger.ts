/**
 * All logging goes to stderr so stdout remains clean for MCP JSON-RPC.
 */

const PREFIX = '[brms]';

export function info(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.error(PREFIX, 'WARN', ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, 'ERROR', ...args);
}

export const log = { info, warn, error };
