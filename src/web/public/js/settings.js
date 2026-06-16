/**
 * Settings page functionality.
 * Manages system prompt, bot settings, API keys, and whitelist.
 */

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadWhitelist();
});

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    // System prompt
    document.getElementById('systemPrompt').value = settings.system_prompt || '';

    // Bot nickname
    document.getElementById('botNickname').value = settings.bot_nickname || '';

    // Activity level
    const levelMap = { low: 0, medium: 1, high: 2 };
    const level = settings.activity_level || 'medium';
    document.getElementById('activityLevel').value = levelMap[level] || 1;
    updateActivityLabels(levelMap[level] || 1);

    // Auto reply
    document.getElementById('autoReplyEnabled').checked = settings.auto_reply_enabled === 'true';

    // Tavily key (show masked)
    const tavilyKey = settings.tavily_api_key || '';
    document.getElementById('tavilyApiKey').value = tavilyKey;

    // Activity level slider
    document.getElementById('activityLevel').addEventListener('input', (e) => {
      updateActivityLabels(parseInt(e.target.value));
    });

  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function updateActivityLabels(value) {
  const labels = ['levelLow', 'levelMedium', 'levelHigh'];
  labels.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.className = '';
  });

  const activeLabel = document.getElementById(labels[value]);
  if (activeLabel) activeLabel.className = 'active';
}

async function saveSettings() {
  const saveStatus = document.getElementById('settingsSaveStatus');
  const saveBtn = document.querySelector('.save-bar .btn-primary');

  saveStatus.textContent = '💾 Сохраняю...';
  saveBtn.disabled = true;

  const levelMap = { 0: 'low', 1: 'medium', 2: 'high' };
  const activityValue = parseInt(document.getElementById('activityLevel').value);

  const settings = {
    system_prompt: document.getElementById('systemPrompt').value,
    bot_nickname: document.getElementById('botNickname').value,
    activity_level: levelMap[activityValue] || 'medium',
    auto_reply_enabled: document.getElementById('autoReplyEnabled').checked ? 'true' : 'false',
    tavily_api_key: document.getElementById('tavilyApiKey').value,
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });

    const data = await res.json();
    if (data.success) {
      saveStatus.textContent = '✅ Настройки сохранены';
      setTimeout(() => {
        saveStatus.textContent = '';
      }, 3000);
    }
  } catch (err) {
    saveStatus.textContent = '❌ Ошибка сохранения';
    console.error('Failed to save settings:', err);
  } finally {
    saveBtn.disabled = false;
  }
}

async function loadWhitelist() {
  try {
    const res = await fetch('/api/groups/whitelist');
    const groups = await res.json();
    renderWhitelist(groups);
  } catch (err) {
    console.error('Failed to load whitelist:', err);
  }
}

function renderWhitelist(groups) {
  const container = document.getElementById('whitelistGroups');
  if (!container) return;

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="loading-spinner">Нет разрешённых групп</div>';
    return;
  }

  container.innerHTML = groups.map((g) => `
    <div class="group-item">
      <div class="group-info">
        <div class="group-name">${escapeHtml(g.group_name || 'Unnamed Group')}</div>
        <div class="group-jid">${escapeHtml(g.group_jid)}</div>
      </div>
      <div class="group-actions">
        <button class="btn btn-sm btn-danger" onclick="removeFromWhitelist('${g.group_jid}')">🗑️ Удалить</button>
      </div>
    </div>
  `).join('');
}

async function removeFromWhitelist(jid) {
  try {
    await fetch(`/api/groups/whitelist/${encodeURIComponent(jid)}`, {
      method: 'DELETE',
    });
    loadWhitelist();
  } catch (err) {
    console.error('Failed to remove from whitelist:', err);
  }
}

async function fetchAndAddAllGroups() {
  try {
    const res = await fetch('/api/groups');
    const groups = await res.json();

    for (const group of groups) {
      await fetch(`/api/groups/whitelist/${encodeURIComponent(group.jid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: group.name }),
      });
    }

    loadWhitelist();
  } catch (err) {
    console.error('Failed to add all groups:', err);
  }
}

window.saveSettings = saveSettings;
window.refreshWhitelist = loadWhitelist;
window.fetchAndAddAllGroups = fetchAndAddAllGroups;
window.removeFromWhitelist = removeFromWhitelist;
