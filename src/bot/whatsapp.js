import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

import pino from 'pino';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import config from '../config.js';
import database from '../database.js';

const logger = pino({ name: 'whatsapp-bot' });

/**
 * WhatsApp connection manager using Baileys library.
 * Handles QR code generation, reconnection, and message events.
 */
class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.qrCode = null;
    this.connectionState = 'disconnected';
    this.authDir = path.join(config.sessionDir, 'baileys-auth');
    this.messageHandler = null;
    this.onQRUpdate = null;
    this.onConnectionUpdate = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;

    // Ensure auth directory exists
    if (!existsSync(this.authDir)) {
      mkdirSync(this.authDir, { recursive: true });
    }
  }

  /**
   * Set the message handler callback.
   * @param {Function} handler - (msg) => void
   */
  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  /**
   * Set QR code update callback.
   * @param {Function} cb - (qrCode) => void
   */
  setOnQRUpdate(cb) {
    this.onQRUpdate = cb;
  }

  /**
   * Set connection state update callback.
   * @param {Function} cb - (state) => void
   */
  setOnConnectionUpdate(cb) {
    this.onConnectionUpdate = cb;
  }

  /**
   * Start the WhatsApp connection.
   */
  async start() {
    try {
      logger.info('Starting WhatsApp connection...');

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        browser: Browsers.windows('Chrome'),
        logger: pino({ name: 'baileys', level: 'error' }),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: false,
        generateHighQualityLinkPreview: false,
        shouldSyncHistory: false,
      });

      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          this.qrCode = qr;
          logger.info('QR code received');
          database.logActivity('qr_received', { timestamp: new Date().toISOString() }).catch(() => {});

          if (this.onQRUpdate) {
            this.onQRUpdate(qr);
          }
        }

        if (connection) {
          this.connectionState = connection;
          logger.info(`Connection state: ${connection}`);
          database.logActivity('connection_state', { state: connection }).catch(() => {});

          if (this.onConnectionUpdate) {
            this.onConnectionUpdate(connection);
          }

          if (connection === 'open') {
            this.reconnectAttempts = 0;
            logger.info('WhatsApp connected successfully!');
            database.logActivity('whatsapp_connected', {
              jid: this.sock?.user?.id,
              timestamp: new Date().toISOString(),
            }).catch(() => {});
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : 0;

          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isBadSession = statusCode === 405 || statusCode === DisconnectReason.badSession;

          // If bad session (e.g. 405), clear auth and force fresh QR
          if (isBadSession && this.reconnectAttempts === 0) {
            this.reconnectAttempts++;
            logger.info('Bad session detected (405), clearing auth for fresh QR...');
            this.clearAuthSession().catch(() => {});
            setTimeout(() => this.start(), 2000);
            return;
          }

          const shouldReconnect = !isLoggedOut && this.reconnectAttempts < this.maxReconnectAttempts;

          logger.error(
            { statusCode, isLoggedOut, attempt: this.reconnectAttempts + 1 },
            'WhatsApp connection closed'
          );

          if (shouldReconnect) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 10000);
            logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.start(), delay);
          } else {
            logger.error('Connection closed permanently — check internet and try clearing auth session');
            database.logActivity('connection_lost', { reason: 'permanent', statusCode, isLoggedOut }).catch(() => {});
          }
        }
      });

      // Handle messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          try {
            await this._processMessage(msg);
          } catch (err) {
            logger.error({ err, msgId: msg.key?.id }, 'Error processing message');
          }
        }
      });

      // Handle group participant updates
      this.sock.ev.on('group-participants.update', (update) => {
        logger.info({ update }, 'Group participants update');
      });

      logger.info('WhatsApp event listeners registered');
    } catch (err) {
      logger.error({ err }, 'Failed to start WhatsApp connection');
      this.connectionState = 'disconnected';
    }
  }

  /**
   * Process an incoming message.
   * @param {object} msg - Baileys message object
   */
  async _processMessage(msg) {
    const key = msg.key;
    const jid = key.remoteJid;

    // Ignore status broadcasts and own messages
    if (jid === 'status@broadcast') return;
    if (key.fromMe) return;

    const isGroup = jid.endsWith('@g.us');
    const messageType = Object.keys(msg.message || {})[0];
    const messageContent = this._extractMessageContent(msg);

    if (!messageContent && messageType !== 'imageMessage' && messageType !== 'videoMessage') {
      return; // Skip unsupported message types
    }

    // Get sender info
    let sender = key.participant || jid;
    let senderName = '';

    if (isGroup) {
      try {
        const groupMetadata = await this.sock.groupMetadata(jid);
        const participant = groupMetadata.participants.find(
          (p) => p.id === sender
        );
        senderName = participant?.name || participant?.notify || sender.split('@')[0] || 'unknown';
      } catch {
        senderName = sender.split('@')[0] || 'unknown';
      }
    } else {
      senderName = msg.pushName || sender.split('@')[0] || 'unknown';
    }

    // Check if bot is mentioned
    const botNumber = this.sock?.user?.id?.split(':')[0]?.split('@')[0] || '';
    const nickname = (await database.getSetting('bot_nickname')) || config.botNickname;
    const textLower = (messageContent || '').toLowerCase();
    const isMentioned =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(this.sock.user.id) ||
      textLower.includes(`@${botNumber}`) ||
      textLower.includes(nickname.toLowerCase());

    // Log message to database
    await database.logMessage({
      jid,
      sender,
      senderName,
      message: messageContent || `[${messageType}]`,
      messageType: messageType || 'unknown',
      isGroup: isGroup ? 1 : 0,
      groupName: isGroup ? await this._getGroupName(jid) : null,
    });

    // Skip if not whitelisted group and is a group
    if (isGroup && !(await database.isGroupWhitelisted(jid))) {
      logger.debug(`Message from non-whitelisted group: ${jid}`);
      return;
    }

    // Pass to message handler
    if (this.messageHandler) {
      await this.messageHandler({
        jid,
        sender,
        senderName,
        message: messageContent || '',
        messageType,
        isGroup,
        isMentioned,
        isCommand: isMentioned && (textLower.startsWith('!') || textLower.startsWith('/')),
        rawMessage: msg,
        isImage: messageType === 'imageMessage',
        isVideo: messageType === 'videoMessage',
      });
    }
  }

  /**
   * Extract text content from a message.
   * @param {object} msg
   * @returns {string|null}
   */
  _extractMessageContent(msg) {
    const msgType = Object.keys(msg.message || {})[0];
    if (!msgType) return null;

    const msgObj = msg.message[msgType];

    if (msgType === 'conversation') return msgObj;
    if (msgType === 'extendedTextMessage') return msgObj.text;
    if (msgType === 'imageMessage') return msgObj.caption || '';
    if (msgType === 'videoMessage') return msgObj.caption || '';

    return null;
  }

  /**
   * Get group name from JID.
   * @param {string} jid
   * @returns {Promise<string>}
   */
  async _getGroupName(jid) {
    try {
      const metadata = await this.sock.groupMetadata(jid);
      return metadata.subject || 'Unknown Group';
    } catch {
      return 'Unknown Group';
    }
  }

  /**
   * Send a text message to a chat.
   * @param {string} jid - Chat JID
   * @param {string} text - Message text
   * @returns {Promise<boolean>}
   */
  async sendMessage(jid, text) {
    try {
      if (!this.sock) {
        logger.error('Cannot send message: socket not initialized');
        return false;
      }

      await this.sock.sendMessage(jid, { text });
      logger.info({ jid, textLength: text.length }, 'Message sent');
      return true;
    } catch (err) {
      logger.error({ err }, 'Failed to send message');
      return false;
    }
  }

  /**
   * Send a reaction to a message.
   * @param {string} jid
   * @param {string} messageId
   * @param {string} emoji
   * @returns {Promise<boolean>}
   */
  async sendReaction(jid, messageId, emoji) {
    try {
      if (!this.sock) return false;

      await this.sock.sendMessage(jid, {
        react: {
          key: { remoteJid: jid, id: messageId, fromMe: false },
          text: emoji,
        },
      });
      return true;
    } catch (err) {
      logger.error({ err }, 'Failed to send reaction');
      return false;
    }
  }

  /**
   * Get the current QR code.
   * @returns {string|null}
   */
  getQR() {
    return this.qrCode;
  }

  /**
   * Get connection status.
   * @returns {string}
   */
  getStatus() {
    return this.connectionState;
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  isConnected() {
    return this.connectionState === 'open';
  }

  /**
   * Get bot's own JID.
   * @returns {string|null}
   */
  getBotJid() {
    return this.sock?.user?.id || null;
  }

  /**
   * Logout and disconnect.
   */
  async logout() {
    try {
      if (this.sock) {
        this.sock.logout();
        this.sock = null;
      }
      this.connectionState = 'disconnected';
      this.qrCode = null;
      logger.info('Logged out');
    } catch (err) {
      logger.error({ err }, 'Logout failed');
    }
  }

  /**
   * Clear auth session data and reset connection.
   */
  async clearAuthSession() {
    try {
      if (existsSync(this.authDir)) {
        rmSync(this.authDir, { recursive: true, force: true });
        mkdirSync(this.authDir, { recursive: true });
        logger.info('Auth session cleared — QR will be requested on next start');
        await database.logActivity('auth_session_cleared', {}).catch(() => {});
      }
    } catch (err) {
      logger.error({ err }, 'Failed to clear auth session');
    }
  }

  /**
   * Get list of groups the bot is in.
   * @returns {Promise<object[]>}
   */
  async getGroups() {
    try {
      if (!this.sock) return [];
      const groups = await this.sock.groupFetchAllParticipating();
      const entries = await Promise.all(
        Object.entries(groups).map(async ([jid, metadata]) => ({
          jid,
          name: metadata.subject,
          participants: metadata.participants?.length || 0,
          isWhitelisted: await database.isGroupWhitelisted(jid),
        }))
      );
      return entries;
    } catch (err) {
      logger.error({ err }, 'Failed to fetch groups');
      return [];
    }
  }
}

export default WhatsAppBot;
