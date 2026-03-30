/**
 * BRMS Popup — Setup wizard + live status
 */

const setupView = document.getElementById('setupView');
const statusView = document.getElementById('statusView');
const statusBadge = document.getElementById('statusBadge');
const hostStatus = document.getElementById('hostStatus');
const activeTab = document.getElementById('activeTab');
const networkCount = document.getElementById('networkCount');
const consoleCount = document.getElementById('consoleCount');
const versionLabel = document.getElementById('versionLabel');
const disconnectBtn = document.getElementById('disconnectBtn');

versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

const installCmd = document.getElementById('installCmd');
const extId = chrome.runtime.id;
installCmd.textContent = `npx brms-host install --extension-id=${extId}`;

// ── Copy buttons ────────────────────────────────────────────────

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const code = document.getElementById(targetId);
    navigator.clipboard.writeText(code.textContent.trim()).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });
});

// ── Health check ────────────────────────────────────────────────

async function checkHealth() {
  try {
    const res = await fetch('http://localhost:3100/health');
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function updateStatus() {
  const connected = await checkHealth();

  if (connected) {
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge connected';
    setupView.classList.add('hidden');
    statusView.classList.remove('hidden');
    hostStatus.textContent = 'Running';
  } else {
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge disconnected';
    setupView.classList.remove('hidden');
    statusView.classList.add('hidden');
  }
}

// ── Disconnect ──────────────────────────────────────────────────

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'disconnect' });
  updateStatus();
});

// ── Init ────────────────────────────────────────────────────────

updateStatus();
setInterval(updateStatus, 5000);
