export interface DOMNode {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  attributes: Record<string, string>;
  children: DOMNode[];
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number | null;
  statusText: string;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  resourceType: string;
  timing: {
    startTime: number;
    duration: number;
  };
  timestamp: number;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  location: string | null;
}

export interface PageInfo {
  index: number;
  title: string;
  url: string;
}

export interface NetworkFilter {
  urlPattern?: string;
  statusCode?: number;
  resourceType?: string;
  limit?: number;
}

// Phase 2

export interface ComputedStyleResult {
  selector: string;
  styles: Record<string, string>;
}

export interface LayoutInfo {
  selector: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  isVisible: boolean;
  isInViewport: boolean;
}

// Phase 3

export interface DebugIssue {
  issue: string;
  reasons: string[];
  confidence: number;
}
