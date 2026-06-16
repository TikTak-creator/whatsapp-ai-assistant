import config from '../config.js';

/**
 * Short-term memory — keeps last N messages per chat.
 * Acts as a ring buffer per JID (chat/conversation ID).
 */
class ShortTermMemory {
  constructor() {
    this.buffers = new Map();
    this.limit = config.shortTermLimit;
  }

  /**
   * Add a message to the short-term buffer for a given chat.
   * @param {string} jid - Chat/Group JID
   * @param {object} message - Message object {role, content, timestamp, sender, ...}
   */
  add(jid, message) {
    if (!this.buffers.has(jid)) {
      this.buffers.set(jid, []);
    }

    const buffer = this.buffers.get(jid);
    buffer.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
    });

    // Trim if exceeds limit
    if (buffer.length > this.limit) {
      this.buffers.set(jid, buffer.slice(-this.limit));
    }
  }

  /**
   * Get recent messages for a given chat.
   * @param {string} jid - Chat/Group JID
   * @param {number} [count] - Number of recent messages (default: all)
   * @returns {object[]}
   */
  getRecent(jid, count) {
    const buffer = this.buffers.get(jid) || [];
    if (count && count < buffer.length) {
      return buffer.slice(-count);
    }
    return buffer;
  }

  /**
   * Get all messages for a given chat (up to limit).
   * @param {string} jid
   * @returns {object[]}
   */
  getAll(jid) {
    return this.buffers.get(jid) || [];
  }

  /**
   * Get approximate token count for a chat's buffer.
   * Rough estimate: 1 token ≈ 4 characters for English/Russian mixed text.
   * @param {string} jid
   * @returns {number}
   */
  getTokenCount(jid) {
    const buffer = this.buffers.get(jid) || [];
    let totalChars = 0;

    for (const msg of buffer) {
      if (msg.content) {
        totalChars += msg.content.length;
      }
    }

    return Math.ceil(totalChars / 3.5);
  }

  /**
   * Clear buffer for a specific chat.
   * @param {string} jid
   */
  clear(jid) {
    this.buffers.delete(jid);
  }

  /**
   * Get context string for AI prompt.
   * @param {string} jid
   * @param {number} [maxMessages] - Max messages to include
   * @returns {string}
   */
  getContextString(jid, maxMessages = 50) {
    const messages = this.getRecent(jid, maxMessages);
    if (messages.length === 0) return '';

    return messages
      .map((m) => {
        const sender = m.senderName || m.sender || 'unknown';
        return `[${m.timestamp?.split('T')[1]?.split('.')[0] || ''}] ${sender}: ${m.content}`;
      })
      .join('\n');
  }

  /**
   * Get messages formatted for LLM conversation array.
   * @param {string} jid
   * @param {number} [maxMessages]
   * @returns {object[]} Array of {role, content} objects
   */
  getConversationForLLM(jid, maxMessages = 50) {
    const messages = this.getRecent(jid, maxMessages);
    return messages.map((m) => ({
      role: m.role || 'user',
      content: m.content,
    }));
  }
}

export default ShortTermMemory;
