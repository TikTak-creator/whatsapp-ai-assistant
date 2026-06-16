import pino from 'pino';
import config from '../config.js';
import database from '../database.js';

const logger = pino({ name: 'long-term-memory' });

/**
 * Long-term memory system.
 * Monitors token usage and triggers compression when limit is exceeded.
 */
class LongTermMemory {
  /**
   * @param {import('./shortTerm.js').default} shortTerm
   * @param {import('./compressor.js').default} compressor
   */
  constructor(shortTerm, compressor) {
    this.shortTerm = shortTerm;
    this.compressor = compressor;
    this.maxTokens = config.maxContextTokens;
    this.compressedMemory = null;
    this.lastCompressionAt = null;

    // Load latest compression from DB
    this._loadFromDb();
  }

  _loadFromDb() {
    try {
      const saved = database.getLatestMemoryCompression();
      if (saved) {
        this.compressedMemory = {
          summary: saved.summary,
          events: this._parseField(saved.events),
          userStyles: this._parseField(saved.user_styles),
          keyFacts: this._parseField(saved.key_facts),
          patterns: this._parseField(saved.patterns),
          tokenCount: saved.token_count,
          compressedAt: saved.created_at,
        };
        this.lastCompressionAt = saved.created_at;
        logger.info('Loaded compressed memory from database');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to load memory from DB');
    }
  }

  _parseField(field) {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }

  /**
   * Estimate token count for a given JID's short-term buffer.
   * @param {string} jid
   * @returns {number}
   */
  estimateCurrentTokens(jid) {
    const shortTermTokens = this.shortTerm.getTokenCount(jid);
    const compressedTokens = this.compressedMemory?.tokenCount || 0;
    return shortTermTokens + compressedTokens;
  }

  /**
   * Get the formatted long-term memory context.
   * @returns {string}
   */
  getFormattedMemory() {
    if (!this.compressor || !this.compressedMemory) return '';
    return this.compressor.formatMemoryForPrompt(this.compressedMemory);
  }

  /**
   * Check if compression is needed and trigger if so.
   * @param {string} jid - Chat/Group JID that triggered this check
   * @returns {Promise<boolean>} True if compression was performed
   */
  async checkAndCompress(jid) {
    const currentTokens = this.estimateCurrentTokens(jid);

    if (currentTokens < this.maxTokens) {
      return false; // No compression needed
    }

    logger.warn(
      `Token limit exceeded: ${currentTokens}/${this.maxTokens}. Starting compression...`
    );

    const messages = this.shortTerm.getAll(jid);
    const compressed = await this.compressor.compress(messages);

    // Save to database
    database.saveMemoryCompression({
      summary: compressed.summary,
      events: compressed.events,
      patterns: compressed.patterns,
      userStyles: compressed.userStyles,
      keyFacts: compressed.keyFacts,
      tokenCount: compressed.tokenCount,
    });

    // Update in-memory state
    this.compressedMemory = compressed;
    this.lastCompressionAt = compressed.compressedAt;

    // Clear short-term buffer (keep last 20 messages for continuity)
    const lastMessages = this.shortTerm.getRecent(jid, 20);
    this.shortTerm.clear(jid);
    for (const msg of lastMessages) {
      this.shortTerm.add(jid, msg);
    }

    database.logActivity('memory_compressed', {
      previousTokens: currentTokens,
      compressedTokens: compressed.tokenCount,
      messageCount: messages.length,
    });

    logger.info(`Compression complete: ${currentTokens} → ${compressed.tokenCount} tokens`);
    return true;
  }

  /**
   * Get the current memory state info for the admin panel.
   * @param {string} jid
   * @returns {object}
   */
  getMemoryInfo(jid) {
    const shortTermTokens = this.shortTerm.getTokenCount(jid);
    const compressedTokens = this.compressedMemory?.tokenCount || 0;

    return {
      shortTermTokens,
      compressedTokens,
      totalTokens: shortTermTokens + compressedTokens,
      maxTokens: this.maxTokens,
      compressedTargetTokens: config.compressedTargetTokens,
      usagePercent: Math.round(((shortTermTokens + compressedTokens) / this.maxTokens) * 100),
      lastCompressionAt: this.lastCompressionAt,
      shortTermMessageCount: this.shortTerm.getAll(jid).length,
      compressedMemory: this.compressedMemory,
    };
  }
}

export default LongTermMemory;
