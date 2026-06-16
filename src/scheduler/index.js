import cron from 'node-cron';
import pino from 'pino';
import config from '../config.js';
import database from '../database.js';

const logger = pino({ name: 'scheduler' });

/**
 * Scheduler system for delayed and recurring tasks.
 * Timezone: Asia/Bishkek (+06:00)
 *
 * Uses node-cron for checking pending tasks every minute,
 * with a fallback to in-memory setTimeout.
 */
class Scheduler {
  constructor() {
    this.timers = new Map();
    this.cronJob = null;
    this.onTaskDue = null; // Callback (jid, message) => void
    this.isRunning = false;
  }

  /**
   * Set the callback for when a task is due.
   * @param {Function} callback - (jid, message, taskId) => void
   */
  setOnTaskDue(callback) {
    this.onTaskDue = callback;
  }

  /**
   * Start the scheduler.
   */
  start() {
    if (this.isRunning) return;

    // Check every 30 seconds for due tasks
    this.cronJob = cron.schedule('*/30 * * * * *', () => {
      this._checkPendingTasks();
    });

    this.isRunning = true;
    logger.info(`Scheduler started (timezone: ${config.botTimezone})`);
  }

  /**
   * Stop the scheduler.
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  /**
   * Check for pending tasks that are due.
   */
  async _checkPendingTasks() {
    try {
      const pendingTasks = await database.getPendingTasks();

      for (const task of pendingTasks) {
        logger.info({ taskId: task.id }, 'Executing scheduled task');

        // Mark as executed
        await database.markTaskExecuted(task.id);

        // Execute callback
        if (this.onTaskDue) {
          try {
            this.onTaskDue(task.jid, task.message, task.id);
          } catch (err) {
            logger.error({ err, taskId: task.id }, 'Task execution callback failed');
          }
        }

        await database.logActivity('task_executed', {
          taskId: task.id,
          jid: task.jid,
          message: task.message,
        });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to check pending tasks');
    }
  }

  /**
   * Schedule a new task.
   * @param {object} params
   * @param {string} params.jid - Chat JID to send message to
   * @param {string} params.time - ISO string or relative time description
   * @param {string} params.message - Message text to send
   * @returns {Promise<number>} Task ID
   */
  async scheduleTask({ jid, time, message }) {
    const scheduledTime = this._parseTime(time);

    if (!scheduledTime) {
      throw new Error(`Invalid time: ${time}`);
    }

    const taskId = await database.createTask({
      jid: jid || '',
      scheduledTime: scheduledTime.toISOString(),
      message,
    });

    // Also set an in-memory timer as backup
    const delay = scheduledTime.getTime() - Date.now();
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      // Only for tasks within 24 hours
      const timer = setTimeout(() => {
        database.markTaskExecuted(taskId).catch(() => {});
        if (this.onTaskDue) {
          try {
            this.onTaskDue(jid, message, taskId);
          } catch (err) {
            logger.error({ err, taskId }, 'Timer callback failed');
          }
        }
        this.timers.delete(taskId);
      }, delay);

      this.timers.set(taskId, timer);
    }

    logger.info({ taskId, scheduledTime: scheduledTime.toISOString() }, 'Task scheduled');
    await database.logActivity('task_created', { taskId, jid, time: scheduledTime.toISOString(), message });

    return taskId;
  }

  /**
   * Parse a time string into a Date object.
   * Supports:
   * - ISO strings: "2024-01-01T19:36:00+06:00"
   * - Relative times: "через 1 минуту", "через 5 минут", "через 2 часа"
   * - Time of day: "19:36" (today at that time)
   * @param {string} timeStr
   * @returns {Date|null}
   */
  _parseTime(timeStr) {
    if (!timeStr) return null;

    // Try parsing as ISO string
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    const now = new Date();

    // Try parsing "ЧЧ:ММ" format (today at that time)
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const date = new Date(now);
      date.setHours(hours, minutes, 0, 0);

      // If time has passed, schedule for tomorrow
      if (date <= now) {
        date.setDate(date.getDate() + 1);
      }
      return date;
    }

    // Try parsing relative time patterns (Russian)
    const relativePatterns = [
      { regex: /через\s+(\d+)\s*мин/i, multiplier: 60 * 1000 },
      { regex: /через\s+(\d+)\s*минут/i, multiplier: 60 * 1000 },
      { regex: /через\s+(\d+)\s*час/i, multiplier: 60 * 60 * 1000 },
      { regex: /через\s+(\d+)\s*часов/i, multiplier: 60 * 60 * 1000 },
      { regex: /через\s+(\d+)\s*дн/i, multiplier: 24 * 60 * 60 * 1000 },
      { regex: /через\s+(\d+)\s*сек/i, multiplier: 1000 },
      { regex: /через\s+(\d+)\s*недел/i, multiplier: 7 * 24 * 60 * 60 * 1000 },
    ];

    for (const { regex, multiplier } of relativePatterns) {
      const match = timeStr.match(regex);
      if (match) {
        const value = parseInt(match[1], 10);
        return new Date(Date.now() + value * multiplier);
      }
    }

    logger.warn({ timeStr }, 'Could not parse time string');
    return null;
  }

  /**
   * Cancel a scheduled task.
   * @param {number} taskId
   */
  cancelTask(taskId) {
    // Clear in-memory timer if exists
    if (this.timers.has(taskId)) {
      clearTimeout(this.timers.get(taskId));
      this.timers.delete(taskId);
    }

    await database.cancelTask(taskId);
    logger.info({ taskId }, 'Task cancelled');
  }

  /**
   * Delete a task.
   * @param {number} taskId
   */
  deleteTask(taskId) {
    if (this.timers.has(taskId)) {
      clearTimeout(this.timers.get(taskId));
      this.timers.delete(taskId);
    }

    await database.deleteTask(taskId);
    logger.info({ taskId }, 'Task deleted');
  }

  /**
   * Get all scheduled tasks.
   * @returns {object[]}
   */
  async getTasks() {
    return database.getAllTasks();
  }
}

export default Scheduler;
