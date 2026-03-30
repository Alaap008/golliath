/**
 * BRMS Background Service Worker
 *
 * Responsibilities:
 * - Connect to native messaging host (brms-host)
 * - Route requests from host to content script or chrome.* APIs
 * - Capture network traffic via chrome.debugger (Network domain)
 * - Capture console output via chrome.debugger (Runtime domain)
 * - Push network/console entries to host in real time
 */

const HOST_NAME = 'com.brms.host';

let nativePort = null;
let activeTabId = null;
let debuggerAttached = new Set();
let networkEnabled = new Set();
let runtimeEnabled = new Set();

// Pending network requests (requestId -> partial entry)
const pendingRequests = new Map();

// ── Native Messaging ────────────────────────────────────────────

function connectNative() {
  if (nativePort) return;

  nativePort = chrome.runtime.connectNative(HOST_NAME);

  nativePort.onMessage.addListener((msg) => {
    handleHostMessage(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    console.error('[brms] Native host disconnected', err?.message ?? '');
    nativePort = null;
  });

  sendPush('extension_ready', { version: chrome.runtime.getManifest().version });
  console.log('[brms] Connected to native host');
}

function sendToHost(msg) {
  if (!nativePort) {
    console.warn('[brms] Cannot send — native host not connected');
    return;
  }
  nativePort.postMessage(msg);
}

function sendResponse(id, type, payload, error) {
  sendToHost({ id, kind: 'response', type, payload: payload ?? {}, error });
}

function sendPush(type, payload) {
  sendToHost({ kind: 'push', type, payload: payload ?? {} });
}

// ── Message Router ──────────────────────────────────────────────

async function handleHostMessage(msg) {
  if (msg.kind !== 'request') return;

  const { id, type, payload } = msg;

  try {
    let result;

    switch (type) {
      case 'list_tabs':
        result = await handleListTabs();
        break;
      case 'select_tab':
        result = await handleSelectTab(payload);
        break;
      case 'screenshot':
        result = await handleScreenshot(payload);
        break;
      case 'get_event_listeners':
        result = await handleGetEventListeners(payload);
        break;
      case 'dom_snapshot':
      case 'dom_query':
      case 'get_styles':
      case 'get_layout':
      case 'get_visible':
      case 'debug_element':
      case 'highlight_element':
      case 'remove_highlight':
      case 'correlate_dom_check':
      case 'get_element_rect':
        result = await forwardToContentScript(type, payload);
        break;
      default:
        throw new Error(`Unknown request type: ${type}`);
    }

    sendResponse(id, type, result);
  } catch (err) {
    sendResponse(id, type, null, err.message || String(err));
  }
}

// ── Tab Management ──────────────────────────────────────────────

async function handleListTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((t, i) => ({
      index: i,
      tabId: t.id,
      title: t.title || '',
      url: t.url || '',
    })),
  };
}

async function handleSelectTab(payload) {
  const { tabId, index } = payload;

  let targetTabId = tabId;

  if (targetTabId === undefined && index !== undefined) {
    const tabs = await chrome.tabs.query({});
    if (index < 0 || index >= tabs.length) {
      throw new Error(`Tab index ${index} out of range (0–${tabs.length - 1})`);
    }
    targetTabId = tabs[index].id;
  }

  if (targetTabId === undefined) {
    throw new Error('Provide tabId or index');
  }

  activeTabId = targetTabId;

  await attachDebugger(activeTabId);
  await enableNetworkCapture(activeTabId);
  await enableConsoleCapture(activeTabId);

  const tab = await chrome.tabs.get(activeTabId);
  return {
    tabId: activeTabId,
    title: tab.title || '',
    url: tab.url || '',
  };
}

// ── Screenshot ──────────────────────────────────────────────────

async function handleScreenshot(payload) {
  if (!activeTabId) throw new Error('No active tab selected');

  const format = payload.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = payload.quality ?? 80;

  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format, quality });
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

  if (payload.selector) {
    const rectResult = await forwardToContentScript('get_element_rect', { selector: payload.selector });
    if (rectResult.rect) {
      return { base64, mimeType: `image/${format}`, elementRect: rectResult.rect };
    }
  }

  return { base64, mimeType: `image/${format}` };
}

// ── Event Listeners (via chrome.debugger) ───────────────────────

async function handleGetEventListeners(payload) {
  if (!activeTabId) throw new Error('No active tab selected');

  await attachDebugger(activeTabId);

  const { selector } = payload;

  const evalResult = await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    'Runtime.evaluate',
    {
      expression: `(() => {
        const els = document.querySelectorAll(${JSON.stringify(selector)});
        return els.length;
      })()`,
      returnByValue: true,
    }
  );

  const count = evalResult.result?.value ?? 0;
  if (count === 0) return { results: [] };

  const results = [];
  const limit = Math.min(count, 20);

  for (let i = 0; i < limit; i++) {
    const expr = count === 1
      ? `document.querySelector(${JSON.stringify(selector)})`
      : `document.querySelectorAll(${JSON.stringify(selector)})[${i}]`;

    const objResult = await chrome.debugger.sendCommand(
      { tabId: activeTabId },
      'Runtime.evaluate',
      { expression: expr, objectGroup: 'brms-events' }
    );

    const objectId = objResult.result?.objectId;
    if (!objectId) continue;

    const tagResult = await chrome.debugger.sendCommand(
      { tabId: activeTabId },
      'Runtime.evaluate',
      {
        expression: `(() => {
          const el = ${expr};
          return el ? { tag: el.tagName.toLowerCase(), id: el.id || '' } : null;
        })()`,
        returnByValue: true,
      }
    );

    const tag = tagResult.result?.value;
    if (!tag) continue;

    let listenersResult;
    try {
      listenersResult = await chrome.debugger.sendCommand(
        { tabId: activeTabId },
        'DOMDebugger.getEventListeners',
        { objectId }
      );
    } catch {
      continue;
    }

    const listeners = (listenersResult.listeners || []).map((l) => ({
      type: l.type,
      handler: l.handler?.description?.slice(0, 200) ?? '(unknown)',
      useCapture: l.useCapture ?? false,
      once: l.once ?? false,
      passive: l.passive ?? false,
    }));

    results.push({ index: i, tag: tag.tag, id: tag.id, listeners });
  }

  await chrome.debugger.sendCommand(
    { tabId: activeTabId },
    'Runtime.releaseObjectGroup',
    { objectGroup: 'brms-events' }
  ).catch(() => {});

  return { results };
}

// ── Debugger Attach / Enable ────────────────────────────────────

async function attachDebugger(tabId) {
  if (debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached.add(tabId);
    console.log('[brms] Debugger attached to tab', tabId);
  } catch (err) {
    if (!err.message?.includes('Already attached')) {
      throw err;
    }
    debuggerAttached.add(tabId);
  }
}

async function enableNetworkCapture(tabId) {
  if (networkEnabled.has(tabId)) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    networkEnabled.add(tabId);
    console.log('[brms] Network capture enabled for tab', tabId);
  } catch (err) {
    console.error('[brms] Failed to enable Network domain', err);
  }
}

async function enableConsoleCapture(tabId) {
  if (runtimeEnabled.has(tabId)) return;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    runtimeEnabled.add(tabId);
    console.log('[brms] Console capture enabled for tab', tabId);
  } catch (err) {
    console.error('[brms] Failed to enable Runtime domain', err);
  }
}

// ── Debugger Event Listener ─────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId || source.tabId !== activeTabId) return;

  // ── Network events ──
  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, timestamp, type } = params;
    pendingRequests.set(requestId, {
      url: request.url,
      method: request.method,
      requestHeaders: request.headers || {},
      requestBody: request.postData?.slice(0, 32768) ?? null,
      resourceType: type || 'other',
      startTime: timestamp * 1000,
      timestamp: Date.now(),
    });
  }

  if (method === 'Network.responseReceived') {
    const { requestId, response } = params;
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pending.status = response.status;
      pending.statusText = response.statusText || '';
      pending.headers = response.headers || {};
    }
  }

  if (method === 'Network.loadingFinished') {
    const { requestId, timestamp } = params;
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pendingRequests.delete(requestId);

      const entry = {
        url: pending.url,
        method: pending.method,
        status: pending.status ?? null,
        statusText: pending.statusText ?? '',
        headers: pending.headers ?? {},
        requestHeaders: pending.requestHeaders,
        requestBody: pending.requestBody,
        responseBody: null,
        resourceType: pending.resourceType,
        timing: {
          startTime: pending.startTime,
          duration: (timestamp * 1000) - pending.startTime,
        },
        timestamp: pending.timestamp,
      };

      // Try to get response body
      chrome.debugger.sendCommand(
        { tabId: activeTabId },
        'Network.getResponseBody',
        { requestId }
      ).then((bodyResult) => {
        if (bodyResult?.body) {
          entry.responseBody = bodyResult.body.slice(0, 32768);
        }
        sendPush('network_entry', entry);
      }).catch(() => {
        sendPush('network_entry', entry);
      });
    }
  }

  if (method === 'Network.loadingFailed') {
    const { requestId, errorText, timestamp } = params;
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pendingRequests.delete(requestId);
      sendPush('network_entry', {
        url: pending.url,
        method: pending.method,
        status: null,
        statusText: errorText || 'Failed',
        headers: pending.headers ?? {},
        requestHeaders: pending.requestHeaders,
        requestBody: pending.requestBody,
        responseBody: null,
        resourceType: pending.resourceType,
        timing: {
          startTime: pending.startTime,
          duration: (timestamp * 1000) - pending.startTime,
        },
        timestamp: pending.timestamp,
      });
    }
  }

  // ── Console events ──
  if (method === 'Runtime.consoleAPICalled') {
    const { type, args, timestamp, stackTrace } = params;
    const levelMap = { log: 'log', warning: 'warn', error: 'error', info: 'info', debug: 'debug' };
    const level = levelMap[type] || 'log';

    const text = (args || [])
      .map((a) => {
        if (a.type === 'string') return a.value;
        if (a.type === 'number' || a.type === 'boolean') return String(a.value);
        if (a.description) return a.description;
        return JSON.stringify(a.value ?? a.preview ?? a.type);
      })
      .join(' ');

    let location = null;
    if (stackTrace?.callFrames?.length > 0) {
      const frame = stackTrace.callFrames[0];
      location = `${frame.url}:${frame.lineNumber}:${frame.columnNumber}`;
    }

    sendPush('console_entry', {
      level,
      text: text.slice(0, 2000),
      timestamp: timestamp ? timestamp * 1000 : Date.now(),
      location,
    });
  }

  if (method === 'Runtime.exceptionThrown') {
    const { exceptionDetails, timestamp } = params;
    const text = exceptionDetails?.exception?.description
      || exceptionDetails?.text
      || 'Unknown error';

    let location = null;
    if (exceptionDetails?.url) {
      location = `${exceptionDetails.url}:${exceptionDetails.lineNumber ?? 0}:${exceptionDetails.columnNumber ?? 0}`;
    }

    sendPush('console_entry', {
      level: 'error',
      text: text.slice(0, 2000),
      timestamp: timestamp ? timestamp * 1000 : Date.now(),
      location,
    });
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    debuggerAttached.delete(source.tabId);
    networkEnabled.delete(source.tabId);
    runtimeEnabled.delete(source.tabId);
    console.log('[brms] Debugger detached from tab', source.tabId);
  }
});

// ── Content Script Forwarding ───────────────────────────────────

async function forwardToContentScript(type, payload) {
  if (!activeTabId) throw new Error('No active tab selected');

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js'],
    });
  } catch {
    // content script may already be injected
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Content script timeout for ${type}`));
    }, 15000);

    chrome.tabs.sendMessage(activeTabId, { type, payload }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response?.payload ?? {});
    });
  });
}

// ── Tab Lifecycle ───────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    activeTabId = null;
    sendPush('tab_updated', { event: 'removed', tabId });
  }
  debuggerAttached.delete(tabId);
  networkEnabled.delete(tabId);
  runtimeEnabled.delete(tabId);
  pendingRequests.clear();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.url) {
    sendPush('tab_updated', { event: 'navigated', tabId, url: changeInfo.url });
  }
});

// ── Messages from popup / other extension pages ─────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'disconnect') {
    if (nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
    activeTabId = null;
    debuggerAttached.clear();
    networkEnabled.clear();
    runtimeEnabled.clear();
    pendingRequests.clear();
    sendResponse({ ok: true });
  }

  if (msg.action === 'get_status') {
    sendResponse({
      connected: nativePort !== null,
      activeTabId,
    });
  }

  return false;
});

// ── Auto-connect on install / startup ───────────────────────────

chrome.runtime.onStartup.addListener(() => connectNative());
chrome.runtime.onInstalled.addListener(() => connectNative());
