/**
 * Logs page functionality.
 * Displays AI decisions, messages, and activity logs with tab switching.
 */

let currentTab = 'ai-decisions';

document.addEventListener('DOMContentLoaded', () => {
  refreshLogs('ai-decisions');
});

function switchTab(tab) {
  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.classList.toggle('active', el.id === `tab-${tab}`);
  });

  refreshLogs(tab);
}

async function refreshLogs(tab) {
  tab = tab || currentTab;

  switch (tab) {
    case 'ai-decisions':
      await loadAiDecisions();
      break;
    case 'messages':
      await loadMessages();
      break;
    case 'activity':
      await loadActivityLogs();
      break;
  }
}

async function loadAiDecisions() {
  const list = document.getElementById('aiDecisionsList');
  if (!list) return;

  list.innerHTML = '<div class="loading-spinner">Загрузка...</div>';

  try {
    const res = await fetch('/api/logs/ai-decisions?limit=100');
    const decisions = await res.json();
    renderAiDecisions(decisions);
  } catch (err) {
    list.innerHTML = '<div class="error-message">Ошибка загрузки AI решений</div>';
  }
}

function renderAiDecisions(decisions) {
  const list = document.getElementById('aiDecisionsList');
  if (!list) return;

  if (!decisions || decisions.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет AI решений</div>';
    return;
  }

  const actionIcons = {
    send: '📤',
    ignore: '⏭️',
    schedule: '📅',
    search: '🔍',
  };

  list.innerHTML = decisions.map((d) => {
    let aiOutput = {};
    try { aiOutput = JSON.parse(d.ai_output); } catch {}

    return `
      <div class="log-item">
        <div class="log-header">
          <span>
            ${actionIcons[d.action] || '🤖'} ${d.action || 'unknown'}
            · ${escapeHtml(d.reply?.slice(0, 100) || '')}${d.reply?.length > 100 ? '...' : ''}
          </span>
          <span>${formatTime(d.timestamp)}</span>
        </div>
        <div class="log-json">${escapeHtml(JSON.stringify(aiOutput, null, 2))}</div>
      </div>
    `;
  }).join('');
}

async function loadMessages() {
  const list = document.getElementById('messagesList');
  if (!list) return;

  list.innerHTML = '<div class="loading-spinner">Загрузка...</div>';

  try {
    const res = await fetch('/api/messages?limit=100');
    const messages = await res.json();
    renderMessages(messages);
  } catch (err) {
    list.innerHTML = '<div class="error-message">Ошибка загрузки сообщений</div>';
  }
}

function renderMessages(messages) {
  const list = document.getElementById('messagesList');
  if (!list) return;

  if (!messages || messages.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет сообщений</div>';
    return;
  }

  list.innerHTML = messages.map((m) => `
    <div class="log-item">
      <div class="log-header">
        <span>
          <span class="log-sender">${escapeHtml(m.sender_name || m.sender || 'unknown')}</span>
          ${m.is_group ? `📢 ${escapeHtml(m.group_name || '')}` : '💬'}
        </span>
        <span>${formatTime(m.timestamp)}</span>
      </div>
      <div class="log-message">${escapeHtml(m.message || '')}</div>
    </div>
  `).join('');
}

async function loadActivityLogs() {
  const list = document.getElementById('activityList');
  if (!list) return;

  list.innerHTML = '<div class="loading-spinner">Загрузка...</div>';

  try {
    const res = await fetch('/api/logs/activity?limit=100');
    const activities = await res.json();
    renderActivityLogs(activities);
  } catch (err) {
    list.innerHTML = '<div class="error-message">Ошибка загрузки активности</div>';
  }
}

function renderActivityLogs(activities) {
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

  list.innerHTML = activities.map((a) => {
    let details = a.details;
    try { details = JSON.parse(details); } catch {}

    return `
      <div class="log-item">
        <div class="log-header">
          <span>${eventIcons[a.event_type] || '📝'} ${escapeHtml(a.event_type)}</span>
          <span>${formatTime(a.timestamp)}</span>
        </div>
        <div class="log-json">${escapeHtml(typeof details === 'string' ? details : JSON.stringify(details, null, 2))}</div>
      </div>
    `;
  }).join('');
}

window.switchTab = switchTab;
window.refreshLogs = refreshLogs;
