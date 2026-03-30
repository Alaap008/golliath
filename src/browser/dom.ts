import type { Page } from 'playwright';
import type { DOMNode } from '../types/index.js';

const DEFAULT_DEPTH = 10;
const DEFAULT_MAX_NODES = 1000;

export async function getSnapshot(
  page: Page,
  selector?: string,
  maxDepth: number = DEFAULT_DEPTH,
  maxNodes: number = DEFAULT_MAX_NODES,
): Promise<DOMNode | DOMNode[]> {
  return page.evaluate(
    ({ sel, depth, limit }) => {
      let nodeCount = 0;

      function walk(el: Element, currentDepth: number): any {
        if (nodeCount >= limit) return null;
        nodeCount++;

        const attrs: Record<string, string> = {};
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }

        const children: any[] = [];
        if (currentDepth < depth) {
          for (const child of el.children) {
            const c = walk(child, currentDepth + 1);
            if (c) children.push(c);
          }
        }

        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          classes: [...el.classList],
          text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
            ? (el.childNodes[0].textContent || '').trim().slice(0, 200)
            : '',
          attributes: attrs,
          children,
        };
      }

      if (sel) {
        const elements = document.querySelectorAll(sel);
        return [...elements].map((el) => walk(el, 0)).filter(Boolean);
      }

      return walk(document.documentElement, 0);
    },
    { sel: selector ?? null, depth: maxDepth, limit: maxNodes },
  );
}

export async function queryDOM(
  page: Page,
  selector: string,
): Promise<Array<{ tag: string; id: string; classes: string[]; text: string; attributes: Record<string, string> }>> {
  return page.evaluate((sel) => {
    const elements = document.querySelectorAll(sel);
    return [...elements].map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: [...el.classList],
      text: (el.textContent || '').trim().slice(0, 300),
      attributes: Object.fromEntries(
        [...el.attributes].map((a) => [a.name, a.value]),
      ),
    }));
  }, selector);
}
