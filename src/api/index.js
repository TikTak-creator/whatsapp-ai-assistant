import { Router } from 'express';
import pino from 'pino';
import database from '../database.js';
import config from '../config.js';

const logger = pino({ name: 'api' });

/**
 * REST API router for bot management.
 * Provides endpoints consumed by the admin panel.
 */
function createApiRouter(whatsappBot, aiBrain, shortTermMemory, longTermMemory, scheduler) {
  const router = Router();

  // Simple auth middleware
  router.use((req, res, next) => {
    const auth = req.headers.authorization;

    if (req.path === '/auth/login') {
      return next();
    }

    if (auth && auth.startsWith('Basic ')) {
      const base64 = auth.split(' ')[1];
      const [username, password] = Buffer.from(base64, 'base64').toString().split(':');

      if (username === config.adminUsername && password === config.adminPassword) {
        return next();
      }
    }

    // For browser fetch with credentials, check cookie
    if (req.headers.cookie?.includes('auth_token=admin')) {
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
  });

  // === Auth ===
  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};

    if (username === config.adminUsername && password === config.adminPassword) {
      return res.json({
        success: true,
        token: Buffer.from(`${username}:${password}`).toString('base64'),
      });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
  });

  // === Bot Status ===
  router.get('/status', (req, res) => {
    res.json({
      connected: whatsappBot.isConnected(),
      state: whatsappBot.getStatus(),
      qr: whatsappBot.getQR(),
      botJid: whatsappBot.getBotJid(),
      uptime: process.uptime(),
    });
  });

  // === QR Code ===
  router.get('/qr', (req, res) => {
    const qr = whatsappBot.getQR();
    if (qr) {
      res.json({ qr, connected: whatsappBot.isConnected() });
    } else {
      res.json({ qr: null, connected: whatsappBot.isConnected(), message: 'No QR available' });
    }
  });

  // === Settings ===
  router.get('/settings', async (req, res) => {
    try {
      const settings = await database.getAllSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const updates = req.body;
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Invalid settings' });
      }

      for (const [key, value] of Object.entries(updates)) {
        await database.setSetting(key, String(value));
      }

      await database.logActivity('settings_updated', updates);
      const settings = await database.getAllSettings();
      logger.info({ updates }, 'Settings updated');
      res.json({ success: true, settings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === Groups ===
  router.get('/groups', async (req, res) => {
    try {
      const groups = await whatsappBot.getGroups();
      res.json(groups);
    } catch (err) {
      res.json([]);
    }
  });

  router.put('/groups/whitelist/:jid', async (req, res) => {
    try {
      const { jid } = req.params;
      const { name } = req.body || {};
      await database.addGroupToWhitelist(jid, name || '');
      await database.logActivity('group_whitelisted', { jid, name });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/groups/whitelist/:jid', async (req, res) => {
    try {
      const { jid } = req.params;
      await database.removeGroupFromWhitelist(jid);
      await database.logActivity('group_unwhitelisted', { jid });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/groups/whitelist', async (req, res) => {
    try {
      const groups = await database.getWhitelistedGroups();
      res.json(groups);
    } catch (err) {
      res.json([]);
    }
  });

  // === Memory ===
  router.get('/memory/:jid?', (req, res) => {
    const jid = req.params.jid || 'default';
    const info = longTermMemory?.getMemoryInfo(jid) || {};
    res.json(info);
  });

  router.get('/memory/compressions', async (req, res) => {
    try {
      const compressions = await database.getAllMemoryCompressions();
      res.json(compressions);
    } catch (err) {
      res.json([]);
    }
  });

  // === Messages / Logs ===
  router.get('/messages/:jid?', async (req, res) => {
    try {
      const jid = req.params.jid;
      const limit = parseInt(req.query.limit, 10) || 100;
      const messages = await database.getRecentMessages(limit, jid);
      res.json(messages);
    } catch (err) {
      res.json([]);
    }
  });

  router.get('/logs/ai-decisions', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const decisions = await database.getRecentAiDecisions(limit);
      res.json(decisions);
    } catch (err) {
      res.json([]);
    }
  });

  router.get('/logs/activity', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const activities = await database.getRecentActivity(limit);
      res.json(activities);
    } catch (err) {
      res.json([]);
    }
  });

  // === Scheduler ===
  router.get('/scheduler/tasks', async (req, res) => {
    try {
      const tasks = await scheduler.getTasks();
      res.json(tasks);
    } catch (err) {
      res.json([]);
    }
  });

  router.post('/scheduler/tasks', async (req, res) => {
    const { jid, time, message } = req.body || {};
    if (!time || !message) {
      return res.status(400).json({ error: 'Time and message are required' });
    }

    try {
      const taskId = await scheduler.scheduleTask({ jid: jid || '', time, message });
      res.json({ success: true, taskId });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/scheduler/tasks/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await scheduler.deleteTask(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/scheduler/tasks/:id/cancel', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await scheduler.cancelTask(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === Bot actions ===
  router.post('/bot/send', async (req, res) => {
    const { jid, text } = req.body || {};
    if (!jid || !text) {
      return res.status(400).json({ error: 'JID and text are required' });
    }

    const success = await whatsappBot.sendMessage(jid, text);
    res.json({ success });
  });

  router.post('/bot/reconnect', async (req, res) => {
    if (!whatsappBot.isConnected()) {
      await whatsappBot.start();
    }
    res.json({ success: true });
  });

  router.post('/bot/logout', async (req, res) => {
    await whatsappBot.logout();
    res.json({ success: true });
  });

  router.post('/bot/clear-session', async (req, res) => {
    whatsappBot.clearAuthSession();
    await whatsappBot.logout();
    setTimeout(() => whatsappBot.start(), 500);
    res.json({ success: true, message: 'Auth session cleared. QR will be requested on next connect.' });
  });

  // === System ===
  router.get('/system/info', (req, res) => {
    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      timezone: config.botTimezone,
      pid: process.pid,
    });
  });

  return router;
}

export default createApiRouter;
