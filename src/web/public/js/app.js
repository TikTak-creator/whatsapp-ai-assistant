/**
 * Main application script.
 * Handles sidebar status updates and page routing.
 */

// Update sidebar status indicator
wsClient.on('status', (data) => {
  updateStatusIndicator(data);
});

function updateStatusIndicator(data) {
  const indicator = document.getElementById('statusIndicator');
  if (!indicator) return;

  const dot = indicator.querySelector('.status-dot');
  const text = indicator.querySelector('.status-text');

  if (!dot || !text) return;

  if (data.connected) {
    dot.className = 'status-dot online';
    text.textContent = 'Онлайн';
  } else if (data.state === 'qr_received' || data.qr) {
    dot.className = 'status-dot connecting';
    text.textContent = 'QR получен';
  } else if (data.state === 'connecting' || data.state === 'loading') {
    dot.className = 'status-dot connecting';
    text.textContent = 'Подключение...';
  } else if (data.state === 'close' || data.state === 'disconnected') {
    dot.className = 'status-dot offline';
    text.textContent = 'Офлайн';
  } else {
    dot.className = 'status-dot offline';
    text.textContent = data.state || 'Неизвестно';
  }
}

// Highlight active nav item
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');
  });
});

// Format timestamp helper
function formatTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Format date for input
function formatDateForInput(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 16);
}

// Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
