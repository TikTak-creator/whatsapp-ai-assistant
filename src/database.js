import pkg from 'pg';
const { Pool } = pkg;
import config from './config.js';
import pino from 'pino';

const logger = pino({ name: 'database' });

/**
 * Database manager for PostgreSQL.
 * Uses connection pooling with SSL for Render.com PostgreSQL.
 */
class DatabaseManager {
  constructor() {
    this.pool = null;
    this.ready = this.init();
  }

  async init() {
    const dbUrl = config.databaseUrl;

    if (!dbUrl) {
      logger.warn('DATABASE_URL not set — using in-memory fallback (data lost on restart!)');
      // Create a minimal in-memory JS store as fallback
      this._useFallback = true;
      this._memoryStore = {
        settings: new Map(),
        whitelist: [],
        messages: [],
        aiDecisions: [],
        tasks: [],
        memories: [],
        activities: [],
        sessions: new Map(),
      };
      return this;
    }

    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false, // Render requires SSL but self-signed cert
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    try {
      const client = await this.pool.connect();
      logger.info('PostgreSQL connected successfully');
      client.release();

      // Create tables
      await this.createTables();
      logger.info('Database tables created/verified');
    } catch (err) {
      logger.error({ err }, 'PostgreSQL connection failed');
      throw new Error(`Database connection failed: ${err.message}`);
    }

    return this;
  }

  async query(text, params = []) {
    if (this._useFallback) {
      throw new Error('Database not configured — set DATABASE_URL');
    }
    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (err) {
      logger.error({ err, text, params }, 'Query error');
      throw err;
    }
  }

  async _run(sql, params = []) {
    await this.query(sql, params);
  }

  async _get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }

  async _all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async waitReady() {
    await this.ready;
  }

  async createTables() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS groups_whitelist (
        id SERIAL PRIMARY KEY,
        group_jid TEXT UNIQUE NOT NULL,
        group_name TEXT,
        added_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS messages_log (
        id SERIAL PRIMARY KEY,
        jid TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_name TEXT,
        message TEXT,
        message_type TEXT DEFAULT 'text',
        is_group INTEGER DEFAULT 0,
        group_name TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS ai_decisions_log (
        id SERIAL PRIMARY KEY,
        jid TEXT,
        input_context TEXT,
        ai_output TEXT,
        action TEXT,
        reply TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        jid TEXT,
        scheduled_time TIMESTAMP NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        executed_at TIMESTAMP
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS long_term_memory (
        id SERIAL PRIMARY KEY,
        summary TEXT NOT NULL,
        events TEXT,
        patterns TEXT,
        user_styles TEXT,
        key_facts TEXT,
        token_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        id SERIAL PRIMARY KEY,
        session_name TEXT UNIQUE NOT NULL,
        session_data TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert default settings if not exist
    const defaults = [
      ['system_prompt', 'Ты — полезный AI-ассистент в WhatsApp группе. Отвечай на русском языке. Будь дружелюбным, информативным и лаконичным.'],
      ['bot_nickname', config.botNickname],
      ['activity_level', config.botActivityLevel],
      ['tavily_api_key', config.tavilyApiKey],
      ['allowed_groups', '[]'],
      ['auto_reply_enabled', 'true'],
    ];

    for (const [key, value] of defaults) {
      await this.query(
        'INSERT INTO bot_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
        [key, value]
      );
    }
  }

  // === Settings ===
  async getSetting(key) {
    const row = await this._get('SELECT value FROM bot_settings WHERE key = $1', [key]);
    return row ? row.value : null;
  }

  async setSetting(key, value) {
    await this.query(
      'INSERT INTO bot_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value]
    );
  }

  async getAllSettings() {
    const rows = await this._all('SELECT key, value FROM bot_settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  // === Whitelist Groups ===
  async getWhitelistedGroups() {
    return this._all('SELECT * FROM groups_whitelist');
  }

  async isGroupWhitelisted(groupJid) {
    const row = await this._get('SELECT id FROM groups_whitelist WHERE group_jid = $1', [groupJid]);
    return !!row;
  }

  async addGroupToWhitelist(groupJid, groupName) {
    await this.query(
      'INSERT INTO groups_whitelist (group_jid, group_name) VALUES ($1, $2) ON CONFLICT (group_jid) DO NOTHING',
      [groupJid, groupName || '']
    );
  }

  async removeGroupFromWhitelist(groupJid) {
    await this.query('DELETE FROM groups_whitelist WHERE group_jid = $1', [groupJid]);
  }

  // === Messages Log ===
  async logMessage({ jid, sender, senderName, message, messageType = 'text', isGroup = 0, groupName }) {
    await this.query(
      'INSERT INTO messages_log (jid, sender, sender_name, message, message_type, is_group, group_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [jid, sender, senderName || '', message || '', messageType, isGroup ? 1 : 0, groupName || '']
    );
  }

  async getRecentMessages(limit = 100, jid = null) {
    let sql = 'SELECT * FROM messages_log';
    const params = [];

    if (jid) {
      sql += ' WHERE jid = $1';
      params.push(jid);
    }

    sql += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    return (await this._all(sql, params)).reverse();
  }

  // === AI Decisions ===
  async logAiDecision({ jid, inputContext, aiOutput, action, reply }) {
    await this.query(
      'INSERT INTO ai_decisions_log (jid, input_context, ai_output, action, reply) VALUES ($1, $2, $3, $4, $5)',
      [jid || '', inputContext ? JSON.stringify(inputContext) : '', JSON.stringify(aiOutput), action || '', reply || '']
    );
  }

  async getRecentAiDecisions(limit = 50) {
    return this._all('SELECT * FROM ai_decisions_log ORDER BY timestamp DESC LIMIT $1', [limit]);
  }

  // === Scheduled Tasks ===
  async createTask({ jid, scheduledTime, message }) {
    const result = await this.query(
      'INSERT INTO scheduled_tasks (jid, scheduled_time, message) VALUES ($1, $2, $3) RETURNING id',
      [jid || '', scheduledTime, message]
    );
    return result.rows[0]?.id || null;
  }

  async getPendingTasks() {
    return this._all(
      "SELECT * FROM scheduled_tasks WHERE status = 'pending' AND scheduled_time <= NOW()"
    );
  }

  async getUpcomingTasks() {
    return this._all(
      "SELECT * FROM scheduled_tasks WHERE status = 'pending' ORDER BY scheduled_time ASC"
    );
  }

  async getAllTasks() {
    return this._all('SELECT * FROM scheduled_tasks ORDER BY scheduled_time DESC');
  }

  async markTaskExecuted(id) {
    await this.query(
      "UPDATE scheduled_tasks SET status = 'executed', executed_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async cancelTask(id) {
    await this.query("UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = $1", [id]);
  }

  async deleteTask(id) {
    await this.query('DELETE FROM scheduled_tasks WHERE id = $1', [id]);
  }

  // === Long-term Memory ===
  async saveMemoryCompression({ summary, events, patterns, userStyles, keyFacts, tokenCount }) {
    await this.query(
      'INSERT INTO long_term_memory (summary, events, patterns, user_styles, key_facts, token_count) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        summary || '',
        events ? JSON.stringify(events) : '[]',
        patterns ? JSON.stringify(patterns) : '[]',
        userStyles ? JSON.stringify(userStyles) : '[]',
        keyFacts ? JSON.stringify(keyFacts) : '[]',
        tokenCount || 0,
      ]
    );
  }

  async getLatestMemoryCompression() {
    return this._get('SELECT * FROM long_term_memory ORDER BY created_at DESC LIMIT 1');
  }

  async getAllMemoryCompressions() {
    return this._all('SELECT * FROM long_term_memory ORDER BY created_at DESC');
  }

  // === Activity Log ===
  async logActivity(eventType, details = '') {
    await this.query(
      'INSERT INTO activity_log (event_type, details) VALUES ($1, $2)',
      [eventType, typeof details === 'string' ? details : JSON.stringify(details)]
    );
  }

  async getRecentActivity(limit = 50) {
    return this._all('SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT $1', [limit]);
  }

  // === Session Storage ===
  async saveSession(name, data) {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    await this.query(
      `INSERT INTO bot_sessions (session_name, session_data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (session_name) DO UPDATE SET session_data = $2, updated_at = NOW()`,
      [name, serialized]
    );
  }

  async getSession(name) {
    const row = await this._get('SELECT session_data FROM bot_sessions WHERE session_name = $1', [name]);
    return row ? row.session_data : null;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('Database pool closed');
    }
  }
}

// Singleton
const database = new DatabaseManager();
export default database;
