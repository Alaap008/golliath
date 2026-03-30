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

export interface OverlapInfo {
  coveredBy: {
    tag: string;
    id: string;
    classes: string[];
    zIndex: string;
  } | null;
  checkedPoints: Array<{
    label: string;
    x: number;
    y: number;
    hitTag: string;
    hitId: string;
    isSelf: boolean;
  }>;
}

export interface EventListenerEntry {
  type: string;
  handler: string;
  useCapture: boolean;
  once: boolean;
  passive: boolean;
}

export interface EventListenerInfo {
  selector: string;
  element: { tag: string; id: string };
  listeners: EventListenerEntry[];
}

export interface DebugIssue {
  issue: string;
  reasons: string[];
  confidence: number;
}

export interface DebugCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export type Severity = 'critical' | 'warning' | 'info';

export interface CorrelationResult {
  domain: string;
  severity: Severity;
  details: string;
  evidence: string[];
}

export interface NetworkDiagnosis {
  totalRequests: number;
  timingBuckets: {
    fast: number;
    normal: number;
    slow: number;
    verySlow: number;
  };
  p95ResponseTime: number;
  failedRequests: Array<{
    url: string;
    status: number | null;
    method: string;
    errorBody: string | null;
  }>;
  corsIssues: Array<{ url: string; method: string }>;
  rateLimited: Array<{ url: string; domain: string }>;
  failuresByDomain: Record<string, number>;
  summary: string;
}
