import pino from 'pino';
import database from '../database.js';

const logger = pino({ name: 'message-handler' });

/**
 * Handles incoming WhatsApp messages and orchestrates AI responses.
 * Routes messages through: filter -> AI brain -> execute action
 */
class MessageHandler {
  /**
   * @param {import('./whatsapp.js').default} whatsappBot
   * @param {import('../ai/brain.js').default} aiBrain
   * @param {import('../memory/shortTerm.js').default} shortTermMemory
   * @param {import('../memory/longTerm.js').default} longTermMemory
   * @param {import('../scheduler/index.js').default} scheduler
   */
  constructor(whatsappBot, aiBrain, shortTermMemory, longTermMemory, scheduler) {
    this.bot = whatsappBot;
    this.brain = aiBrain;
    this.shortTerm = shortTermMemory;
    this.longTerm = longTermMemory;
    this.scheduler = scheduler;

    // Register as the bot's message handler
    this.bot.setMessageHandler((msg) => this.handleMessage(msg));

    // Register scheduler callback for sending scheduled messages
    this.scheduler.setOnTaskDue((jid, message, taskId) => {
      this.bot.sendMessage(jid, `⏰ Напоминание: ${message}`).catch((err) => {
        logger.error({ err, taskId }, 'Failed to send scheduled message');
      });
    });
  }

  /**
   * Handle an incoming message.
   * @param {object} msg - Parsed message from WhatsAppBot
   */
  async handleMessage(msg) {
    const {
      jid,
      sender,
      senderName,
      message,
      isGroup,
      isMentioned,
      isCommand,
    } = msg;

    try {
      // 1. Add to short-term memory
      this.shortTerm.add(jid, {
        role: 'user',
        content: message,
        sender: sender,
        senderName: senderName,
        timestamp: new Date().toISOString(),
      });

      // 2. Check and trigger memory compression if needed
      const didCompress = await this.longTerm.checkAndCompress(jid);
      if (didCompress) {
        logger.info('Memory compression completed');
      }

      // 3. Check for direct commands first
      const commandResult = await this._handleCommands(msg);
      if (commandResult) {
        return; // Command was handled
      }

      // 4. Get recent messages for AI context
      const recentMessages = this.shortTerm.getAll(jid);

      // 5. Run through AI brain for decision
      const decision = await this.brain.decide({
        chatJid: jid,
        message,
        sender,
        senderName,
        isMentioned,
        isCommand,
        recentMessages: recentMessages.slice(-30),
      });

      // 6. Execute the decision
      await this._executeDecision(jid, msg, decision);

      // 7. Log any errors from the decision
      if (decision._error) {
        await database.logActivity('ai_error', {
          jid,
          error: decision._error,
          message,
        }).catch(() => {});
      }
    } catch (err) {
      logger.error({ err, jid, message }, 'Error handling message');
      await database.logActivity('handler_error', {
        jid,
        error: err.message,
        message,
      }).catch(() => {});
    }
  }

  /**
   * Handle direct commands.
   * @param {object} msg
   * @returns {Promise<boolean>} True if command was handled
   */
  async _handleCommands(msg) {
    const { jid, message, senderName } = msg;
    const text = message?.toLowerCase().trim() || '';

    // Status command
    if (text.includes('статус') || text.includes('status')) {
      const status = this.bot.isConnected() ? '🟢 Онлайн' : '🔴 Офлайн';
      const groups = await this.bot.getGroups();
      await this.bot.sendMessage(
        jid,
        `🤖 *Статус бота*\n\n` +
        `Состояние: ${status}\n` +
        `Групп: ${groups.length}\n` +
        `Память: ${this.shortTerm.getTokenCount(jid)} токенов\n` +
        `Активность: ${(await database.getSetting('activity_level')) || 'medium'}`
      );
      return true;
    }

    // Help command
    if (text.includes('помоги') || text.includes('help') || text.includes('команды')) {
      await this.bot.sendMessage(
        jid,
        `🤖 *Команды бота*\n\n` +
        `• @бот статус — статус бота\n` +
        `• @бот помоги — список команд\n` +
        `• @бот напомни через [время] [текст] — напоминание\n` +
        `• @бот поищи [запрос] — поиск информации\n` +
        `• @бот скажи [текст] — сказать что-либо`
      );
      return true;
    }

    // Reminder command
    const reminderMatch = text.match(/напомни\s+(?:через\s+)?(.+?)(?:\s+(?:напиши|что|:|\s))(.+)/);
    if (reminderMatch || text.includes('напомни')) {
      // Let AI handle scheduling via the brain's structured output
      return false; // Pass to AI
    }

    return false; // Not a command
  }

  /**
   * Execute the AI's decision.
   * @param {string} jid
   * @param {object} msg - Original message
   * @param {object} decision - AI decision object
   */
  async _executeDecision(jid, msg, decision) {
    const { reply, action, tool, schedule, react } = decision;

    // 1. Send reaction if requested
    if (react && msg.rawMessage?.key?.id) {
      await this.bot.sendReaction(jid, msg.rawMessage.key.id, react);
    }

    // 2. Execute tool if requested (Tavily search)
    let searchResults = null;
    if (tool && tool.name === 'tavily') {
      searchResults = await this.brain.executeSearch(tool.query || '');
      await database.logActivity('tool_executed', {
        tool: 'tavily',
        query: tool.query,
      }).catch(() => {});
    }

    // 3. Execute based on action
    switch (action) {
      case 'send':
        if (reply) {
          let finalReply = reply;
          // If we have search results, append them or generate a combined reply
          if (searchResults) {
            finalReply = await this.brain.generateSearchReply(msg, searchResults);
          }
          await this.bot.sendMessage(jid, finalReply);
        }
        break;

      case 'search':
        if (!searchResults) {
          searchResults = await this.brain.executeSearch(reply || 'поиск');
        }
        // Generate final response with search results
        if (searchResults) {
          const searchReply = await this.brain.generateSearchReply(msg, searchResults);
          await this.bot.sendMessage(jid, searchReply);
        }
        break;

      case 'schedule':
        if (schedule?.time) {
          try {
            await this.scheduler.scheduleTask({
              jid,
              time: schedule.time,
              message: schedule.message || reply,
            });
            await this.bot.sendMessage(
              jid,
              `⏰ Запланировал сообщение на ${new Date(schedule.time).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })}`
            );
          } catch (err) {
            logger.error({ err }, 'Failed to schedule task');
            await this.bot.sendMessage(
              jid,
              '❌ Не удалось запланировать сообщение. Пожалуйста, укажи время в формате "ЧЧ:ММ".'
            );
          }
        }
        break;

      case 'ignore':
        // Do nothing
        break;

      default:
        logger.warn({ action }, 'Unknown action from AI');
    }

    // 4. Add bot's reply to short-term memory
    if (reply && action !== 'ignore') {
      this.shortTerm.add(jid, {
        role: 'assistant',
        content: reply,
        sender: 'bot',
        senderName: (await database.getSetting('bot_nickname')) || 'AI Assistant',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export default MessageHandler;
