/**
 * Shared message types for communication between the brms-host (Node.js)
 * and the Chrome extension via Native Messaging.
 */

// ── Request types (host → extension) ────────────────────────────

export type BrmsRequestType =
  | 'list_tabs'
  | 'select_tab'
  | 'dom_snapshot'
  | 'dom_query'
  | 'get_styles'
  | 'get_layout'
  | 'get_visible'
  | 'debug_element'
  | 'highlight_element'
  | 'remove_highlight'
  | 'screenshot'
  | 'get_event_listeners'
  | 'correlate_dom_check';

export interface BrmsRequest {
  id: string;
  kind: 'request';
  type: BrmsRequestType;
  payload: Record<string, unknown>;
}

// ── Response types (extension → host) ───────────────────────────

export interface BrmsResponse {
  id: string;
  kind: 'response';
  type: string;
  payload: Record<string, unknown>;
  error?: string;
}

// ── Push types (extension → host, unsolicited) ─────────────────

export type BrmsPushType =
  | 'network_entry'
  | 'console_entry'
  | 'tab_updated'
  | 'extension_ready';

export interface BrmsPush {
  kind: 'push';
  type: BrmsPushType;
  payload: Record<string, unknown>;
}

// ── Union envelope ──────────────────────────────────────────────

export type BrmsMessage = BrmsRequest | BrmsResponse | BrmsPush;
