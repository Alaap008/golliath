import { bridge } from '../bridge/native-messaging.js';
import type { DOMNode } from '../types/index.js';

const DEFAULT_DEPTH = 10;
const DEFAULT_MAX_NODES = 1000;

export async function getSnapshot(
  selector?: string,
  maxDepth: number = DEFAULT_DEPTH,
  maxNodes: number = DEFAULT_MAX_NODES,
): Promise<DOMNode | DOMNode[]> {
  const result = await bridge.sendRequest('dom_snapshot', {
    selector: selector ?? null,
    depth: maxDepth,
    maxNodes,
  });
  return result.tree as DOMNode | DOMNode[];
}

export async function queryDOM(
  selector: string,
): Promise<Array<{ tag: string; id: string; classes: string[]; text: string; attributes: Record<string, string> }>> {
  const result = await bridge.sendRequest('dom_query', { selector });
  return (result.elements ?? []) as Array<{ tag: string; id: string; classes: string[]; text: string; attributes: Record<string, string> }>;
}
