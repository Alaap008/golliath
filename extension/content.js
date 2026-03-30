/**
 * BRMS Content Script
 *
 * Runs in the context of every web page. Handles DOM-touching operations
 * requested by the background service worker.
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { type, payload } = msg;

  const handler = HANDLERS[type];
  if (!handler) {
    sendResponse({ error: `Unknown content script handler: ${type}` });
    return false;
  }

  try {
    const result = handler(payload || {});
    if (result instanceof Promise) {
      result
        .then((r) => sendResponse({ payload: r }))
        .catch((err) => sendResponse({ error: err.message || String(err) }));
      return true; // keep channel open for async
    }
    sendResponse({ payload: result });
  } catch (err) {
    sendResponse({ error: err.message || String(err) });
  }

  return false;
});

// ── Handler Registry ────────────────────────────────────────────

const HANDLERS = {
  dom_snapshot: handleDomSnapshot,
  dom_query: handleDomQuery,
  get_styles: handleGetStyles,
  get_layout: handleGetLayout,
  get_visible: handleGetVisible,
  debug_element: handleDebugElement,
  highlight_element: handleHighlightElement,
  remove_highlight: handleRemoveHighlight,
  correlate_dom_check: handleCorrelateDomCheck,
  get_element_rect: handleGetElementRect,
};

// ── DOM Snapshot ────────────────────────────────────────────────

function handleDomSnapshot({ selector, depth = 10, maxNodes = 1000 }) {
  let nodeCount = 0;

  function walk(el, currentDepth) {
    if (nodeCount >= maxNodes) return null;
    nodeCount++;

    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }

    const children = [];
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

  if (selector) {
    const elements = document.querySelectorAll(selector);
    return { tree: [...elements].map((el) => walk(el, 0)).filter(Boolean) };
  }

  return { tree: walk(document.documentElement, 0) };
}

// ── DOM Query ───────────────────────────────────────────────────

function handleDomQuery({ selector }) {
  const elements = document.querySelectorAll(selector);
  return {
    elements: [...elements].map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: [...el.classList],
      text: (el.textContent || '').trim().slice(0, 300),
      attributes: Object.fromEntries(
        [...el.attributes].map((a) => [a.name, a.value]),
      ),
    })),
  };
}

// ── Get Styles ──────────────────────────────────────────────────

function handleGetStyles({ selector, properties, includeAncestors, includePseudo }) {
  const defaultProps = [
    'display', 'position', 'visibility', 'opacity', 'zIndex', 'pointerEvents',
    'overflow', 'width', 'height', 'margin', 'padding', 'color',
    'backgroundColor', 'fontSize', 'fontWeight',
  ];
  const keys = properties || defaultProps;
  const elements = document.querySelectorAll(selector);

  return {
    results: [...elements].map((el) => {
      const computed = window.getComputedStyle(el);
      const styles = {};
      for (const key of keys) {
        styles[key] = computed.getPropertyValue(key) || computed[key] || '';
      }

      const result = {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: [...el.classList],
        styles,
      };

      if (includePseudo) {
        const before = window.getComputedStyle(el, '::before');
        const after = window.getComputedStyle(el, '::after');
        result.pseudoElements = {
          before: { content: before.content, display: before.display, position: before.position, width: before.width, height: before.height },
          after: { content: after.content, display: after.display, position: after.position, width: after.width, height: after.height },
        };
      }

      if (includeAncestors) {
        const ancestorKeys = ['overflow', 'position', 'zIndex', 'display', 'visibility', 'opacity'];
        const chain = [];
        let parent = el.parentElement;
        while (parent && parent !== document.documentElement) {
          const pc = window.getComputedStyle(parent);
          const ancestorStyles = {};
          for (const k of ancestorKeys) {
            ancestorStyles[k] = pc[k] || '';
          }
          chain.push({
            tag: parent.tagName.toLowerCase(),
            id: parent.id || '',
            classes: [...parent.classList],
            styles: ancestorStyles,
          });
          parent = parent.parentElement;
        }
        result.ancestorChain = chain;
      }

      return result;
    }),
  };
}

// ── Get Layout ──────────────────────────────────────────────────

function handleGetLayout({ selector }) {
  const elements = document.querySelectorAll(selector);
  return {
    results: [...elements].map((el) => {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);

      const isVisible =
        computed.display !== 'none' &&
        computed.visibility !== 'hidden' &&
        parseFloat(computed.opacity) > 0 &&
        rect.width > 0 && rect.height > 0;

      const isInViewport =
        rect.top < window.innerHeight && rect.bottom > 0 &&
        rect.left < window.innerWidth && rect.right > 0;

      const points = [
        { label: 'center', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { label: 'top-left', x: rect.left + 2, y: rect.top + 2 },
        { label: 'top-right', x: rect.right - 2, y: rect.top + 2 },
        { label: 'bottom-left', x: rect.left + 2, y: rect.bottom - 2 },
        { label: 'bottom-right', x: rect.right - 2, y: rect.bottom - 2 },
      ];

      const checkedPoints = points.map((p) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return {
          label: p.label,
          x: Math.round(p.x),
          y: Math.round(p.y),
          hitTag: hit ? hit.tagName.toLowerCase() : 'none',
          hitId: hit ? (hit.id || '') : '',
          isSelf: hit === el || (hit !== null && el.contains(hit)),
        };
      });

      const isCovered = rect.width > 0 && rect.height > 0 && checkedPoints.every((p) => !p.isSelf);
      const coveringPoint = checkedPoints.find((p) => !p.isSelf && p.hitTag !== 'none');
      let coveredBy = null;
      if (coveringPoint) {
        const coverEl = document.elementFromPoint(coveringPoint.x, coveringPoint.y);
        if (coverEl) {
          coveredBy = {
            tag: coverEl.tagName.toLowerCase(),
            id: coverEl.id || '',
            classes: [...coverEl.classList],
            zIndex: window.getComputedStyle(coverEl).zIndex,
          };
        }
      }

      const clippingAncestors = [];
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        const ps = window.getComputedStyle(parent);
        if (ps.overflow === 'hidden' || ps.overflow === 'clip' ||
            ps.overflowX === 'hidden' || ps.overflowY === 'hidden') {
          const pRect = parent.getBoundingClientRect();
          const isClipped =
            rect.right > pRect.right || rect.left < pRect.left ||
            rect.bottom > pRect.bottom || rect.top < pRect.top;
          if (isClipped) {
            clippingAncestors.push({
              tag: parent.tagName.toLowerCase(),
              id: parent.id || '',
              overflow: ps.overflow,
            });
          }
        }
        parent = parent.parentElement;
      }

      const scrollContext = {
        pageScrollX: Math.round(window.scrollX),
        pageScrollY: Math.round(window.scrollY),
        requiresScroll: !isInViewport && rect.width > 0 && rect.height > 0,
        scrollToY: Math.round(rect.top + window.scrollY - window.innerHeight / 2),
      };

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: [...el.classList],
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        isVisible,
        isInViewport,
        isCovered,
        coveredBy,
        checkedPoints,
        clippingAncestors,
        scrollContext,
      };
    }),
  };
}

// ── Get Visible Elements ────────────────────────────────────────

function handleGetVisible() {
  const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick], [tabindex]';
  const elements = document.querySelectorAll(interactiveSelectors);

  return {
    elements: [...elements]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);
        const isVisible =
          computed.display !== 'none' &&
          computed.visibility !== 'hidden' &&
          parseFloat(computed.opacity) > 0 &&
          rect.width > 0 && rect.height > 0;

        const isInViewport =
          rect.top < window.innerHeight && rect.bottom > 0 &&
          rect.left < window.innerWidth && rect.right > 0;

        if (!isVisible || !isInViewport) return null;

        const htmlEl = el;
        const isDisabled =
          htmlEl.hasAttribute('disabled') ||
          htmlEl.getAttribute('aria-disabled') === 'true' ||
          computed.pointerEvents === 'none';

        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          classes: [...el.classList],
          text: (el.textContent || '').trim().slice(0, 100),
          type: el.getAttribute('type') || '',
          href: el.getAttribute('href') || '',
          name: el.getAttribute('name') || '',
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          tabindex: el.getAttribute('tabindex') || '',
          isDisabled,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .filter(Boolean),
  };
}

// ── Debug Element ───────────────────────────────────────────────

function handleDebugElement({ selector }) {
  const el = document.querySelector(selector);
  if (!el) return { found: false, checks: [], issues: [] };

  const rect = el.getBoundingClientRect();
  const computed = window.getComputedStyle(el);
  const htmlEl = el;
  const checks = [];
  const issues = [];

  function fail(name, detail) {
    checks.push({ name, passed: false, detail });
    issues.push(detail);
  }
  function pass(name, detail) {
    checks.push({ name, passed: true, detail });
  }

  if (computed.display === 'none') fail('display', 'Element has display: none');
  else pass('display', `display: ${computed.display}`);

  if (computed.visibility === 'hidden') fail('visibility', 'Element has visibility: hidden');
  else pass('visibility', `visibility: ${computed.visibility}`);

  if (parseFloat(computed.opacity) === 0) fail('opacity', 'Element has opacity: 0');
  else pass('opacity', `opacity: ${computed.opacity}`);

  if (rect.width === 0 || rect.height === 0) fail('dimensions', `Element has zero size: ${rect.width}x${rect.height}`);
  else pass('dimensions', `${Math.round(rect.width)}x${Math.round(rect.height)}`);

  if (computed.pointerEvents === 'none') fail('pointer-events', 'Element has pointer-events: none');
  else pass('pointer-events', `pointer-events: ${computed.pointerEvents}`);

  const isInViewport =
    rect.top < window.innerHeight && rect.bottom > 0 &&
    rect.left < window.innerWidth && rect.right > 0;
  if (!isInViewport) fail('viewport', 'Element is outside the viewport');
  else pass('viewport', 'Element is in viewport');

  const isDisabled = htmlEl.hasAttribute('disabled');
  const ariaDisabled = htmlEl.getAttribute('aria-disabled') === 'true';
  if (isDisabled) fail('disabled', 'Element has disabled attribute');
  else if (ariaDisabled) fail('aria-disabled', 'Element has aria-disabled="true"');
  else pass('disabled-state', 'Not disabled');

  const points = [
    { label: 'center', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { label: 'top-left', x: rect.left + 2, y: rect.top + 2 },
    { label: 'top-right', x: rect.right - 2, y: rect.top + 2 },
    { label: 'bottom-left', x: rect.left + 2, y: rect.bottom - 2 },
    { label: 'bottom-right', x: rect.right - 2, y: rect.bottom - 2 },
  ];
  const coveredPoints = [];
  let coveringElement = null;

  for (const p of points) {
    const hit = document.elementFromPoint(p.x, p.y);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      coveredPoints.push(p.label);
      if (!coveringElement) {
        const hitTag = hit.tagName.toLowerCase();
        const hitId = hit.id ? `#${hit.id}` : '';
        const hitZ = window.getComputedStyle(hit).zIndex;
        coveringElement = `<${hitTag}${hitId}> (z-index: ${hitZ})`;
      }
    }
  }

  if (coveredPoints.length > 0) {
    fail('overlap', `Covered at ${coveredPoints.join(', ')} by ${coveringElement}`);
  } else if (rect.width > 0 && rect.height > 0) {
    pass('overlap', 'No overlapping elements detected');
  }

  let ancestor = el.parentElement;
  const parentIssues = [];
  while (ancestor && ancestor !== document.documentElement) {
    const ps = window.getComputedStyle(ancestor);
    const aTag = ancestor.tagName.toLowerCase();
    const aId = ancestor.id ? `#${ancestor.id}` : '';

    if (ps.display === 'none') parentIssues.push(`Ancestor <${aTag}${aId}> has display: none`);
    if (ps.visibility === 'hidden') parentIssues.push(`Ancestor <${aTag}${aId}> has visibility: hidden`);
    if (parseFloat(ps.opacity) === 0) parentIssues.push(`Ancestor <${aTag}${aId}> has opacity: 0`);
    if (ps.pointerEvents === 'none') parentIssues.push(`Ancestor <${aTag}${aId}> has pointer-events: none`);

    if (ps.overflow === 'hidden' || ps.overflow === 'clip') {
      const pRect = ancestor.getBoundingClientRect();
      const clipped =
        rect.right > pRect.right || rect.left < pRect.left ||
        rect.bottom > pRect.bottom || rect.top < pRect.top;
      if (clipped) parentIssues.push(`Clipped by <${aTag}${aId}> (overflow: ${ps.overflow})`);
    }

    ancestor = ancestor.parentElement;
  }

  if (parentIssues.length > 0) {
    for (const pi of parentIssues) fail('parent-chain', pi);
  } else {
    pass('parent-chain', 'No ancestor issues detected');
  }

  const allFixed = document.querySelectorAll('*');
  const overlays = [];
  for (const other of allFixed) {
    if (other === el || el.contains(other) || other.contains(el)) continue;
    const os = window.getComputedStyle(other);
    if ((os.position === 'fixed' || os.position === 'absolute') &&
        parseInt(os.zIndex) > 100 && os.display !== 'none') {
      const oRect = other.getBoundingClientRect();
      if (oRect.width > 100 && oRect.height > 100 &&
          oRect.left < rect.right && oRect.right > rect.left &&
          oRect.top < rect.bottom && oRect.bottom > rect.top) {
        overlays.push(`<${other.tagName.toLowerCase()}${other.id ? '#' + other.id : ''}> z-index:${os.zIndex}`);
      }
    }
    if (overlays.length >= 3) break;
  }

  if (overlays.length > 0) {
    fail('stacking-context', `Potential overlay(s): ${overlays.join(', ')}`);
  } else {
    pass('stacking-context', 'No high z-index overlays detected');
  }

  const clickability = {
    cursor: computed.cursor,
    tabindex: htmlEl.getAttribute('tabindex') || '',
    role: htmlEl.getAttribute('role') || '',
    ariaLabel: htmlEl.getAttribute('aria-label') || '',
    hasOnclick: htmlEl.hasAttribute('onclick'),
    isAnchor: el.tagName === 'A',
    isButton: el.tagName === 'BUTTON',
    isInput: el.tagName === 'INPUT',
  };

  return {
    found: true,
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: [...el.classList],
    boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    computedStyles: {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
      position: computed.position,
      zIndex: computed.zIndex,
      overflow: computed.overflow,
      cursor: computed.cursor,
    },
    checks,
    clickability,
    issues,
  };
}

// ── Highlight Element ───────────────────────────────────────────

function handleHighlightElement({ selector }) {
  const el = document.querySelector(selector);
  if (!el) return { highlighted: false };
  el.dataset.brmsOriginalOutline = el.style.outline;
  el.style.outline = '3px solid red';
  return { highlighted: true };
}

function handleRemoveHighlight({ selector }) {
  const el = document.querySelector(selector);
  if (!el) return { removed: false };
  el.style.outline = el.dataset.brmsOriginalOutline || '';
  delete el.dataset.brmsOriginalOutline;
  return { removed: true };
}

// ── Correlate DOM Check ─────────────────────────────────────────

function handleCorrelateDomCheck({ errors }) {
  const results = [];
  for (const errText of (errors || [])) {
    const idMatches = errText.match(/#([\w-]+)/g);
    if (idMatches) {
      for (const match of idMatches.slice(0, 3)) {
        const id = match.slice(1);
        const exists = document.getElementById(id) !== null;
        results.push({ error: errText.slice(0, 150), selector: match, exists });
      }
    }
  }
  return { results };
}

// ── Get Element Rect (for screenshot cropping) ──────────────────

function handleGetElementRect({ selector }) {
  const el = document.querySelector(selector);
  if (!el) return { rect: null };
  const rect = el.getBoundingClientRect();
  return {
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}
