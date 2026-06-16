/**
 * Dashboard page functionality.
 * Displays bot status, QR code, groups, and activity.
 */

// Status updates via WebSocket
wsClient.on('status', (data) => {
  updateBotStatus(data);
  updateQRCode(data);
});

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  fetchGroups();
  fetchActivity();
});

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateBotStatus(data);
    updateQRCode(data);
    updateSystemInfo(data);
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

function updateBotStatus(data) {
  const statusBig = document.getElementById('botStatusBig');
  if (!statusBig) return;

  const dot = statusBig.querySelector('.status-dot-big');
  const label = statusBig.querySelector('.status-label');

  if (data.connected) {
    dot.className = 'status-dot-big online';
    label.textContent = '🟢 Онлайн';
  } else if (data.qr) {
    dot.className = 'status-dot-big connecting';
    label.textContent = '🟡 Ожидание сканирования QR';
  } else {
    dot.className = 'status-dot-big offline';
    label.textContent = '🔴 Отключён';
  }

  // Details
  const jidEl = document.getElementById('botJid');
  const stateEl = document.getElementById('connectionState');
  const uptimeEl = document.getElementById('botUptime');

  if (jidEl) jidEl.textContent = data.botJid || '—';
  if (stateEl) stateEl.textContent = data.state || '—';

  if (uptimeEl && data.uptime) {
    const hours = Math.floor(data.uptime / 3600);
    const mins = Math.floor((data.uptime % 3600) / 60);
    uptimeEl.textContent = `${hours}ч ${mins}мин`;
  }
}

function updateQRCode(data) {
  const qrContainer = document.getElementById('qrContainer');
  if (!qrContainer) return;

  const placeholder = document.getElementById('qrPlaceholder');
  const canvasEl = document.getElementById('qrCanvas');

  if (data.qr && !data.connected) {
    // Show QR code
    if (placeholder) placeholder.style.display = 'none';
    if (canvasEl) canvasEl.style.display = 'block';
    renderQRCode(data.qr);
  } else if (data.connected) {
    // Connected — show success
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.innerHTML = `
        <div style="text-align:center; padding:20px;">
          <div style="font-size:80px; margin-bottom:12px;">✅</div>
          <p style="font-size:16px; font-weight:500;">WhatsApp подключён</p>
          <p style="font-size:13px; color:var(--text-secondary); margin-top:4px;">
            JID: ${escapeHtml(data.botJid || '—')}
          </p>
        </div>
      `;
    }
    if (canvasEl) canvasEl.style.display = 'none';
  } else {
    // No QR yet
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.innerHTML = `
        <div class="qr-icon">📱</div>
        <p>Подключите WhatsApp, отсканировав QR-код</p>
        <p class="qr-hint">QR появится при запуске бота...</p>
      `;
    }
    if (canvasEl) canvasEl.style.display = 'none';
  }
}

function renderQRCode(qrData) {
  const canvas = document.getElementById('qrCodeCanvas');
  if (!canvas) return;

  // Use QRCode library if loaded, otherwise show raw data
  if (typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, qrData, {
      width: 280,
      margin: 2,
      color: {
        dark: '#e8e8f0',
        light: '#1a1a2e',
      },
    }, (err) => {
      if (err) console.error('QR render error:', err);
    });
  } else {
    // Fallback: load QRCode library dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js';
    script.onload = () => {
      QRCode.toCanvas(canvas, qrData, {
        width: 280,
        margin: 2,
        color: {
          dark: '#e8e8f0',
          light: '#1a1a2e',
        },
      });
    };
    document.head.appendChild(script);
  }
}

function updateSystemInfo(data) {
  const groupCount = document.getElementById('groupCount');
  if (groupCount) groupCount.textContent = data.groupCount || '—';
}

async function fetchGroups() {
  try {
    const res = await fetch('/api/groups');
    const groups = await res.json();
    renderGroups(groups);
  } catch (err) {
    console.error('Failed to fetch groups:', err);
  }
}

function renderGroups(groups) {
  const list = document.getElementById('groupsList');
  if (!list) return;

  if (!groups || groups.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет групп. Подключите WhatsApp.</div>';
    return;
  }

  list.innerHTML = groups.map((g) => `
    <div class="group-item">
      <div class="group-info">
        <div class="group-name">${escapeHtml(g.name || 'Unknown Group')}</div>
        <div class="group-jid">${escapeHtml(g.jid)}</div>
      </div>
      <div class="group-actions">
        <span class="whitelist-badge ${g.isWhitelisted ? 'allowed' : 'denied'}">
          ${g.isWhitelisted ? '✅ Разрешена' : '❌ Запрещена'}
        </span>
        ${g.isWhitelisted
          ? `<button class="btn btn-sm btn-danger" onclick="toggleWhitelist('${g.jid}', false)">Удалить</button>`
          : `<button class="btn btn-sm btn-primary" onclick="toggleWhitelist('${g.jid}', true, '${escapeHtml(g.name || '')}')">➕ Добавить</button>`
        }
      </div>
    </div>
  `).join('');
}

async function toggleWhitelist(jid, add, name) {
  try {
    if (add) {
      await fetch(`/api/groups/whitelist/${encodeURIComponent(jid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } else {
      await fetch(`/api/groups/whitelist/${encodeURIComponent(jid)}`, {
        method: 'DELETE',
      });
    }
    fetchGroups();
  } catch (err) {
    console.error('Failed to toggle whitelist:', err);
  }
}

async function fetchActivity() {
  try {
    const res = await fetch('/api/logs/activity?limit=20');
    const activities = await res.json();
    renderActivity(activities);
  } catch (err) {
    console.error('Failed to fetch activity:', err);
  }
}

function renderActivity(activities) {
  const list = document.getElementById('activityList');
  if (!list) return;

  if (!activities || activities.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет активности</div>';
    return;
  }

  const eventIcons = {
    whatsapp_connected: '✅',
    whatsapp_disconnected: '❌',
    connection_state: '🔌',
    qr_received: '📱',
    settings_updated: '⚙️',
    group_whitelisted: '🔓',
    group_unwhitelisted: '🔒',
    task_created: '📅',
    task_executed: '✅',
    memory_compressed: '🧠',
    ai_error: '⚠️',
    handler_error: '🚨',
    tavily_search: '🔍',
    tool_executed: '🛠️',
    bot_started: '🚀',
  };

  list.innerHTML = activities.map((a) => `
    <div class="log-item">
      <div class="log-header">
        <span>${eventIcons[a.event_type] || '📝'} ${escapeHtml(a.event_type)}</span>
        <span>${formatTime(a.timestamp)}</span>
      </div>
      <div class="log-message">${escapeHtml(typeof a.details === 'string' ? a.details : JSON.stringify(a.details))}</div>
    </div>
  `).join('');
}

function refreshDashboard() {
  fetchStatus();
  fetchGroups();
  fetchActivity();
}

window.toggleWhitelist = toggleWhitelist;
window.refreshDashboard = refreshDashboard;
window.refreshGroups = fetchGroups;
