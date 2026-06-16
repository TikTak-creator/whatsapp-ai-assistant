/**
 * Scheduler page functionality.
 * Create, view, cancel, and delete scheduled tasks.
 */

document.addEventListener('DOMContentLoaded', () => {
  refreshTasks();

  // Set default time to +1 hour
  const taskTimeInput = document.getElementById('taskTime');
  if (taskTimeInput) {
    const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
    taskTimeInput.value = formatDateForInput(defaultTime);
  }
});

async function refreshTasks() {
  try {
    const res = await fetch('/api/scheduler/tasks');
    const tasks = await res.json();
    renderTasks(tasks);
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

function renderTasks(tasks) {
  const list = document.getElementById('tasksList');
  if (!list) return;

  if (!tasks || tasks.length === 0) {
    list.innerHTML = '<div class="loading-spinner">Нет запланированных задач</div>';
    return;
  }

  list.innerHTML = tasks.map((task) => {
    const statusClass = task.status || 'pending';
    const statusLabels = {
      pending: '⏳ Ожидает',
      executed: '✅ Выполнено',
      cancelled: '❌ Отменено',
    };

    return `
      <div class="task-item">
        <div class="task-info">
          <div class="task-message">${escapeHtml(task.message || '')}</div>
          <div class="task-meta">
            🕐 ${formatTime(task.scheduled_time)}
            ${task.jid ? `· 📱 ${escapeHtml(task.jid)}` : ''}
            ${task.executed_at ? `· ✅ ${formatTime(task.executed_at)}` : ''}
          </div>
        </div>
        <span class="task-status ${statusClass}">${statusLabels[statusClass] || statusClass}</span>
        ${task.status === 'pending' ? `
          <button class="btn btn-sm btn-danger" onclick="cancelTask(${task.id})">Отменить</button>
        ` : ''}
        <button class="btn btn-sm" onclick="deleteTask(${task.id})">🗑️</button>
      </div>
    `;
  }).join('');
}

async function addTask(event) {
  event.preventDefault();

  const timeInput = document.getElementById('taskTime');
  const messageInput = document.getElementById('taskMessage');
  const jidInput = document.getElementById('taskJid');

  const time = timeInput.value;
  const message = messageInput.value;
  const jid = jidInput.value;

  if (!time || !message) return;

  // Convert local datetime to ISO
  const scheduledDate = new Date(time);
  const isoTime = scheduledDate.toISOString();

  try {
    const res = await fetch('/api/scheduler/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: isoTime, message, jid }),
    });

    const data = await res.json();
    if (data.success) {
      messageInput.value = '';
      refreshTasks();

      // Update default time
      const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
      timeInput.value = formatDateForInput(defaultTime);
    }
  } catch (err) {
    console.error('Failed to create task:', err);
  }
}

async function cancelTask(id) {
  try {
    await fetch(`/api/scheduler/tasks/${id}/cancel`, {
      method: 'POST',
    });
    refreshTasks();
  } catch (err) {
    console.error('Failed to cancel task:', err);
  }
}

async function deleteTask(id) {
  if (!confirm('Удалить задачу?')) return;
  try {
    await fetch(`/api/scheduler/tasks/${id}`, {
      method: 'DELETE',
    });
    refreshTasks();
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
}

window.refreshTasks = refreshTasks;
window.addTask = addTask;
window.cancelTask = cancelTask;
window.deleteTask = deleteTask;
