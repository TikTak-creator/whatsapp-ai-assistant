/**
 * Memory page functionality.
 * Displays token usage, compressed memory, raw context, and compression history.
 */

document.addEventListener('DOMContentLoaded', () => {
  refreshMemory();
  loadCompressions();
});

// WebSocket updates
wsClient.on('memory', (data) => {
  renderMemoryInfo(data);
});

async function refreshMemory() {
  try {
    const res = await fetch('/api/memory');
    const info = await res.json();
    renderMemoryInfo(info);
  } catch (err) {
    console.error('Failed to fetch memory info:', err);
  }
}

function renderMemoryInfo(info) {
  if (!info) return;

  // Token counts
  const shortTerm = info.shortTermTokens || 0;
  const compressed = info.compressedTokens || 0;
  const total = info.totalTokens || 0;
  const maxTokens = info.maxTokens || 256000;
  const usagePercent = info.usagePercent || 0;

  // Short-term
  document.getElementById('shortTermTokens').textContent = `${shortTerm.toLocaleString()} токенов`;
  document.getElementById('shortTermBar').style.width = `${Math.min((shortTerm / 100000) * 100, 100)}%`;

  // Compressed
  document.getElementById('compressedTokens').textContent = `${compressed.toLocaleString()} / 40k`;
  document.getElementById('compressedBar').style.width = `${Math.min((compressed / 40000) * 100, 100)}%`;

  // Total
  document.getElementById('totalTokens').textContent = `${total.toLocaleString()} / ${maxTokens.toLocaleString()}`;
  document.getElementById('totalBar').style.width = `${Math.min(usagePercent, 100)}%`;

  // Stats
  document.getElementById('messageCount').textContent = info.shortTermMessageCount || 0;
  document.getElementById('lastCompression').textContent = info.lastCompressionAt
    ? formatTime(info.lastCompressionAt)
    : '—';

  // Color coding for total bar
  const totalBar = document.getElementById('totalBar');
  if (totalBar) {
    if (usagePercent > 90) {
      totalBar.style.background = 'var(--danger)';
    } else if (usagePercent > 70) {
      totalBar.style.background = 'var(--warning)';
    } else {
      totalBar.style.background = 'linear-gradient(90deg, var(--success), var(--warning), var(--danger))';
    }
  }

  // Render compressed memory content
  renderCompressedMemory(info.compressedMemory);
}

function renderCompressedMemory(compressed) {
  const container = document.getElementById('compressedMemoryContent');
  if (!container) return;

  if (!compressed) {
    container.innerHTML = '<div class="loading-spinner">Нет сжатой памяти</div>';
    return;
  }

  let html = '';

  // Summary
  if (compressed.summary) {
    html += `
      <div class="compressed-section">
        <h4>📝 Сводка</h4>
        <p>${escapeHtml(compressed.summary)}</p>
      </div>
    `;
  }

  // Events
  if (compressed.events && compressed.events.length > 0) {
    html += `
      <div class="compressed-section">
        <h4>📌 Важные события</h4>
        <ul>
          ${compressed.events.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Key facts
  if (compressed.keyFacts && compressed.keyFacts.length > 0) {
    html += `
      <div class="compressed-section">
        <h4>💡 Ключевые факты</h4>
        <ul>
          ${compressed.keyFacts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Patterns
  if (compressed.patterns && compressed.patterns.length > 0) {
    html += `
      <div class="compressed-section">
        <h4>🔄 Паттерны</h4>
        <ul>
          ${compressed.patterns.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // User styles
  if (compressed.userStyles && Object.keys(compressed.userStyles).length > 0) {
    const styles = Object.entries(compressed.userStyles)
      .map(([user, style]) => `<li><strong>${escapeHtml(user)}</strong>: ${escapeHtml(style)}</li>`)
      .join('');
    html += `
      <div class="compressed-section">
        <h4>👤 Стиль пользователей</h4>
        <ul>${styles}</ul>
      </div>
    `;
  }

  container.innerHTML = html || '<div class="loading-spinner">Нет данных</div>';
}

// Raw context toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleRawContext');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const rawEl = document.getElementById('rawContext');
      if (rawEl.style.display === 'none') {
        rawEl.style.display = 'block';
        toggleBtn.textContent = 'Скрыть';

        // Fetch raw context
        try {
          const res = await fetch('/api/messages?limit=100');
          const messages = await res.json();
          rawEl.textContent = JSON.stringify(messages, null, 2);
        } catch (err) {
          rawEl.textContent = 'Ошибка загрузки контекста';
        }
      } else {
        rawEl.style.display = 'none';
        toggleBtn.textContent = 'Показать';
      }
    });
  }
});

async function loadCompressions() {
  try {
    const res = await fetch('/api/memory/compressions');
    const compressions = await res.json();
    renderCompressions(compressions);
  } catch (err) {
    console.error('Failed to load compressions:', err);
  }
}

function renderCompressions(compressions) {
  const list = document.getElementById('compressionsList');
  if (!list) return;

  if (!compressions || compressions.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет компрессий</div>';
    return;
  }

  list.innerHTML = compressions.map((c) => `
    <div class="compression-item">
      <div class="compression-header">
        <span>📦 Компрессия #${c.id}</span>
        <span>${formatTime(c.created_at)} · ${c.token_count || 0} токенов</span>
      </div>
      <div class="compression-summary">${escapeHtml(c.summary?.slice(0, 300) || '')}${c.summary?.length > 300 ? '...' : ''}</div>
    </div>
  `).join('');
}

window.refreshMemory = refreshMemory;
