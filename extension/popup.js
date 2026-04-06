/**
 * BRMS Popup — Setup wizard + live status + domain management
 */

const setupView = document.getElementById('setupView');
const statusView = document.getElementById('statusView');
const statusBadge = document.getElementById('statusBadge');
const hostStatus = document.getElementById('hostStatus');
const bridgeStatus = document.getElementById('bridgeStatus');
const activeTabEl = document.getElementById('activeTab');
const networkCount = document.getElementById('networkCount');
const versionLabel = document.getElementById('versionLabel');
const disconnectBtn = document.getElementById('disconnectBtn');
const reconnectBanner = document.getElementById('reconnectBanner');
const reconnectBtn = document.getElementById('reconnectBtn');

const manifest = chrome.runtime.getManifest();
versionLabel.textContent = `v${manifest.version}`;

// Step 1: install command — display wrapped, copy as single line
const installCmd = document.getElementById('installCmd');
const extId = chrome.runtime.id;
installCmd.textContent = `npx brms-host install \\\n  --extension-id=${extId}`;
// Store the single-line version for clipboard
installCmd.dataset.copy = `npx brms-host install --extension-id=${extId}`;

// ── Copy buttons ────────────────────────────────────────────────

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const el = document.getElementById(targetId);
    // Use data-copy if present (e.g. single-line version of a wrapped command)
    const text = el.dataset.copy || el.textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });
});

// ── Health check ─────────────────────────────────────────────────
// Returns { serverUp, extensionBridged }
// extensionBridged means native messaging is live between extension and host.

async function checkHealth() {
  try {
    const res = await fetch('http://localhost:3100/health', { cache: 'no-store' });
    const data = await res.json();
    return {
      serverUp: data.status === 'ok',
      extensionBridged: Boolean(data.extensionConnected),
    };
  } catch {
    return { serverUp: false, extensionBridged: false };
  }
}

async function updateStatus() {
  const { serverUp, extensionBridged } = await checkHealth();

  if (!serverUp) {
    // Server is not reachable
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge disconnected';
    setupView.classList.remove('hidden');
    statusView.classList.add('hidden');
    return;
  }

  // Server is up — show status view regardless of bridge state
  setupView.classList.add('hidden');
  statusView.classList.remove('hidden');
  hostStatus.textContent = 'Running';

  if (extensionBridged) {
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge connected';
    bridgeStatus.textContent = 'Active';
    reconnectBanner.classList.add('hidden');
  } else {
    // Server up but native messaging bridge not yet established
    statusBadge.textContent = 'Connecting…';
    statusBadge.className = 'badge checking';
    bridgeStatus.textContent = 'Not connected';
    reconnectBanner.classList.remove('hidden');
  }
}

// ── Reconnect ────────────────────────────────────────────────────

reconnectBtn.addEventListener('click', () => {
  reconnectBtn.disabled = true;
  reconnectBtn.textContent = '…';
  chrome.runtime.sendMessage({ action: 'reconnect' }, () => {
    // Give the native host a moment to start, then re-check
    setTimeout(() => {
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'Reconnect';
      updateStatus();
    }, 1500);
  });
});

// ── Disconnect ──────────────────────────────────────────────────

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'disconnect' });
  updateStatus();
});

// ── Domain Management ───────────────────────────────────────────

const domainList = document.getElementById('domainList');
const domainInput = document.getElementById('domainInput');
const addDomainBtn = document.getElementById('addDomainBtn');
const domainError = document.getElementById('domainError');
const domainsCount = document.getElementById('domainsCount');

function normalizeOrigin(input) {
  input = input.trim();
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    const isLocal = input.startsWith('localhost') || input.startsWith('127.0.0.1');
    input = isLocal ? `http://${input}` : `https://${input}`;
  }
  return input.replace(/\/\*$/, '').replace(/\/$/, '') + '/*';
}

function showError(msg) {
  domainError.textContent = msg;
  domainError.classList.remove('hidden');
}

function clearError() {
  domainError.classList.add('hidden');
  domainError.textContent = '';
}

async function loadDomains() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'get_domains' }, (res) => {
      resolve(res?.domains ?? []);
    });
  });
}

function renderDomains(domains) {
  domainsCount.textContent = domains.length;
  domainsCount.className = domains.length > 0 ? 'domains-count has-domains' : 'domains-count';

  domainList.innerHTML = '';

  if (domains.length === 0) {
    const li = document.createElement('li');
    li.className = 'domain-empty';
    li.textContent = 'No domains added yet';
    domainList.appendChild(li);
    return;
  }

  domains.forEach((origin) => {
    const li = document.createElement('li');
    li.className = 'domain-item';

    const span = document.createElement('span');
    span.className = 'domain-origin';
    span.textContent = origin;
    span.title = origin;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'domain-remove';
    removeBtn.title = `Remove ${origin}`;
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => removeDomain(origin));

    li.appendChild(span);
    li.appendChild(removeBtn);
    domainList.appendChild(li);
  });
}

async function removeDomain(origin) {
  clearError();
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'remove_domain', origin }, resolve);
  });
  const domains = await loadDomains();
  renderDomains(domains);
}

// Must originate from a user gesture — chrome.permissions.request requires it
addDomainBtn.addEventListener('click', async () => {
  const raw = domainInput.value.trim();
  if (!raw) return;

  clearError();
  addDomainBtn.disabled = true;
  addDomainBtn.textContent = '…';

  try {
    const origin = normalizeOrigin(raw);
    const granted = await chrome.permissions.request({ origins: [origin] });

    if (!granted) {
      showError('Permission was not granted.');
      return;
    }

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'domain_added', origin }, resolve);
    });

    domainInput.value = '';
    const domains = await loadDomains();
    renderDomains(domains);
  } catch (err) {
    showError(err.message || 'Failed to add domain.');
  } finally {
    addDomainBtn.disabled = false;
    addDomainBtn.textContent = 'Add';
  }
});

domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomainBtn.click();
});

domainInput.addEventListener('input', clearError);

// ── Init ────────────────────────────────────────────────────────

updateStatus();
setInterval(updateStatus, 5000);

loadDomains().then(renderDomains);
