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
const CONTENT_SCRIPT_ID = 'brms-content';

let nativePort = null;
let activeTabId = null;
let debuggerAttached = new Set();
let networkEnabled = new Set();
let runtimeEnabled = new Set();

// Reconnect state
let reconnectTimer = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;
let intentionalDisconnect = false;

// Pending network requests (requestId -> partial entry)
const pendingRequests = new Map();

// ── Domain / Permission Management ──────────────────────────────

async function getStoredDomains() {
  const { domains = [] } = await chrome.storage.local.get('domains');
  return domains;
}

async function saveStoredDomains(domains) {
  await chrome.storage.local.set({ domains });
}

/**
 * Normalize user-typed input to a valid Chrome origin pattern.
 * Examples:
 *   "localhost:3000"      → "http://localhost:3000/*"
 *   "example.com"         → "https://example.com/*"
 *   "https://example.com" → "https://example.com/*"
 */
function normalizeOrigin(input) {
  input = input.trim();
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    const isLocalhost = input.startsWith('localhost') || input.startsWith('127.0.0.1');
    input = isLocalhost ? `http://${input}` : `https://${input}`;
  }
  return input.replace(/\/\*$/, '').replace(/\/$/, '') + '/*';
}

/**
 * Sync the dynamically registered content script to match the current
 * list of granted origins. Handles first-time register, update, and removal.
 */
async function syncContentScripts(origins) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });

  if (origins.length === 0) {
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
    return;
  }

  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      js: ['content.js'],
      matches: origins,
      runAt: 'document_idle',
    }]);
  } else {
    await chrome.scripting.updateContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches: origins,
    }]);
  }
}

// ── Native Messaging ────────────────────────────────────────────

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (intentionalDisconnect) return; // user explicitly disconnected — don't auto-reconnect
  console.log(`[brms] Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connectNative();
  }, reconnectDelay);
}

function connectNative() {
  if (nativePort) return;

  // Clear any pending reconnect timer since we're connecting now
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.error('[brms] Failed to connect to native host:', err?.message ?? err);
    scheduleReconnect();
    return;
  }

  nativePort.onMessage.addListener((msg) => {
    handleHostMessage(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    const reason = err?.message ?? '';
    console.error('[brms] Native host disconnected', reason);
    nativePort = null;

    // Permanent errors — retrying won't help. Stop the loop and surface a clear message.
    const isPermanent =
      reason.includes('forbidden') ||
      reason.includes('not found') ||
      reason.includes('not registered') ||
      reason.includes('Access to the specified');

    if (isPermanent) {
      console.error(
        '[brms] Native host connection permanently failed.\n' +
        'Re-run: npx brms-host install --extension-id=' + chrome.runtime.id
      );
      return; // do NOT schedule reconnect
    }

    scheduleReconnect();
  });

  // Reset backoff on successful connection
  reconnectDelay = 2000;

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

  const annotated = await Promise.all(tabs.map(async (t, i) => {
    let accessible = false;
    try {
      if (t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) {
        const origin = new URL(t.url).origin + '/*';
        accessible = await chrome.permissions.contains({ origins: [origin] });
      }
    } catch {
      // non-parseable URL (e.g. chrome://) — leave accessible: false
    }
    return {
      index: i,
      tabId: t.id,
      title: t.title || '',
      url: t.url || '',
      accessible,
    };
  }));

  return { tabs: annotated };
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

  // Guard: check that the user has granted permission for this tab's origin.
  const tab = await chrome.tabs.get(targetTabId);
  if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    const origin = new URL(tab.url).origin + '/*';
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) {
      throw new Error(
        `No permission for ${new URL(tab.url).origin}. ` +
        `Open the BRMS popup and add this domain first.`
      );
    }
  }

  activeTabId = targetTabId;

  await attachDebugger(activeTabId);
  await enableNetworkCapture(activeTabId);
  await enableConsoleCapture(activeTabId);

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
    intentionalDisconnect = true; // prevent auto-reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
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
    return false;
  }

  if (msg.action === 'get_status') {
    sendResponse({
      connected: nativePort !== null,
      activeTabId,
    });
    return false;
  }

  if (msg.action === 'reconnect') {
    intentionalDisconnect = false; // user wants to reconnect — re-enable auto-reconnect
    reconnectDelay = 2000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!nativePort) connectNative();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'get_domains') {
    getStoredDomains().then((domains) => sendResponse({ domains }));
    return true; // async response
  }

  if (msg.action === 'domain_added') {
    const { origin } = msg;
    getStoredDomains().then(async (domains) => {
      if (!domains.includes(origin)) {
        const updated = [...domains, origin];
        await saveStoredDomains(updated);
        await syncContentScripts(updated);
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'remove_domain') {
    const { origin } = msg;
    getStoredDomains().then(async (domains) => {
      const updated = domains.filter((d) => d !== origin);
      try {
        await chrome.permissions.remove({ origins: [origin] });
      } catch (err) {
        console.warn('[brms] Could not revoke permission for', origin, err);
      }
      await saveStoredDomains(updated);
      await syncContentScripts(updated);
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

// ── Auto-connect on install / startup ───────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  connectNative();
  const domains = await getStoredDomains();
  if (domains.length > 0) {
    await syncContentScripts(domains);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  connectNative();
  const domains = await getStoredDomains();
  if (domains.length > 0) {
    await syncContentScripts(domains);
  }
});
