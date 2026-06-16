import pino from 'pino';
import database from '../database.js';
import tavilyClient from '../tavily/index.js';

const logger = pino({ name: 'ai-brain' });

/**
 * AI Brain — the core decision-making layer.
 * Takes input context and returns a structured JSON action.
 *
 * Input: messages, user context, system prompt, group settings, tavily results
 * Output: { reply, action, tool, schedule, react }
 */
class AIBrain {
  /**
   * @param {import('./provider.js').default} llmProvider
   * @param {import('../memory/longTerm.js').default} longTermMemory
   */
  constructor(llmProvider, longTermMemory) {
    this.llmProvider = llmProvider;
    this.longTermMemory = longTermMemory;
  }

  /**
   * Get the current system prompt from settings.
   * @param {object} [context] - Additional context about group/chat
   * @returns {string}
   */
  async _buildSystemPrompt(context = {}) {
    const systemPrompt = (await database.getSetting('system_prompt')) ||
      'Ты — полезный AI-ассистент в WhatsApp группе. Отвечай на русском языке.';

    const activityLevel = (await database.getSetting('activity_level')) || 'medium';
    const nickname = (await database.getSetting('bot_nickname')) || 'AI Assistant';

    // Add activity level instructions
    let activityInstructions = '';
    switch (activityLevel) {
      case 'low':
        activityInstructions = 'Отвечай только когда тебя явно упомянули (@bot или имя). Будь кратким.';
        break;
      case 'medium':
        activityInstructions = 'Отвечай на упоминания и иногда предлагай помощь, если видишь вопрос.';
        break;
      case 'high':
        activityInstructions = 'Будь проактивным. Отвечай на вопросы, комментируй, предлагай идеи, участвуй в обсуждениях.';
        break;
      default:
        activityInstructions = 'Отвечай на упоминания.';
    }

    // Get long-term memory context
    const memoryContext = this.longTermMemory?.getFormattedMemory() || '';

    return `Ты — ${nickname}, AI-ассистент в WhatsApp группе.

ВАЖНО: Ты должен отвечать ТОЛЬКО на РУССКОМ языке.

${activityInstructions}

${systemPrompt}

${memoryContext ? `\nКОНТЕКСТ ИЗ ПАМЯТИ:\n${memoryContext}\n` : ''}

Твоя задача — анализировать сообщения и возвращать структурированный JSON-ответ.

ФОРМАТ ОТВЕТА (строго JSON, без markdown-разметки):
{
  "reply": "текст ответа или пустая строка если не нужно отвечать",
  "action": "send | ignore | schedule | search",
  "tool": null | { "name": "tavily", "query": "поисковый запрос" },
  "schedule": {
    "time": null | "ISO-дата-время когда отправить",
    "message": null | "текст для отложенной отправки"
  },
  "react": null | "emoji для реакции на сообщение"
}

Правила:
- action "send": отправить reply в чат
- action "ignore": ничего не делать
- action "search": выполнить поиск через Tavily, потом ответить с результатами
- action "schedule": запланировать сообщение на указанное время
- tool: если нужно найти информацию — укажи { "name": "tavily", "query": "запрос" }
- react: можно добавить реакцию emoji на сообщение пользователя
- schedule.time: время в ISO формате с часовым поясом Asia/Bishkek (+06:00)
- Если нечего сказать — установи action "ignore" и reply ""`;
  }

  /**
   * Process incoming messages and decide what to do.
   * @param {object} input
   * @param {string} input.chatJid - Chat/Group JID
   * @param {string} input.message - The incoming message text
   * @param {string} input.sender - Sender's JID
   * @param {string} input.senderName - Sender's display name
   * @param {boolean} input.isMentioned - Whether bot was mentioned
   * @param {boolean} input.isCommand - Whether it's a direct command
   * @param {object[]} input.recentMessages - Recent chat history
   * @returns {Promise<object>} Decision object
   */
  async decide(input) {
    const {
      chatJid,
      message,
      sender,
      senderName,
      isMentioned = false,
      isCommand = false,
      recentMessages = [],
    } = input;

    const activityLevel = (await database.getSetting('activity_level')) || 'medium';

    // Build conversation context
    const conversationHistory = recentMessages
      .slice(-30) // Last 30 messages for context
      .map((m) => ({
        role: m.role || 'user',
        content: `${m.senderName || m.sender || 'unknown'}: ${m.content || ''}`,
      }));

    // Add the current message
    conversationHistory.push({
      role: 'user',
      content: `${senderName || sender}: ${message}`,
    });

    // Check if this needs a response based on activity level
    const needsResponse = isMentioned || isCommand || activityLevel === 'high';

    if (!needsResponse && activityLevel !== 'high') {
      return {
        reply: '',
        action: 'ignore',
        tool: null,
        schedule: { time: null, message: null },
        react: null,
        _reason: 'Bot not mentioned and activity level is not high',
      };
    }

    const systemPrompt = await this._buildSystemPrompt({
      chatJid,
      activityLevel,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];

    try {
      logger.info({ action: 'ai_decide', chatJid, isMentioned }, 'AI Brain deciding...');

      const response = await this.llmProvider.complete({
        messages,
        temperature: 0.7,
        maxTokens: 1024,
        jsonMode: true,
      });

      // Parse the JSON response
      let decision;
      try {
        decision = JSON.parse(response.content);
      } catch {
        // Fallback: try to extract JSON
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          decision = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse AI decision JSON');
        }
      }

      // Validate and normalize
      decision = {
        reply: decision.reply || '',
        action: ['send', 'ignore', 'schedule', 'search'].includes(decision.action)
          ? decision.action
          : 'ignore',
        tool: decision.tool || null,
        schedule: {
          time: decision.schedule?.time || null,
          message: decision.schedule?.message || null,
        },
        react: decision.react || null,
      };

      // Log the decision
      await database.logAiDecision({
        jid: chatJid,
        inputContext: { message, sender: senderName },
        aiOutput: decision,
        action: decision.action,
        reply: decision.reply,
      });

      logger.info({ action: decision.action, hasReply: !!decision.reply }, 'AI decision made');

      return decision;
    } catch (err) {
      logger.error({ err }, 'AI Brain decision failed');

      // Fallback response
      return {
        reply: '',
        action: 'ignore',
        tool: null,
        schedule: { time: null, message: null },
        react: '❌',
        _error: err.message,
      };
    }
  }

  /**
   * Execute a Tavily search and return formatted results.
   * @param {string} query
   * @returns {Promise<string>} Formatted search results
   */
  async executeSearch(query) {
    try {
      const results = await tavilyClient.search(query, {
        maxResults: 5,
        includeImages: true,
        searchDepth: 'advanced',
      });
      return tavilyClient.formatResultsForPrompt(results);
    } catch (err) {
      logger.error({ err }, 'Search execution failed');
      return `Не удалось выполнить поиск: ${err.message}`;
    }
  }

  /**
   * Generate a reply incorporating search results.
   * @param {object} input
   * @param {string} searchResults - Formatted search results string
   * @returns {Promise<string>} Final reply
   */
  async generateSearchReply(input, searchResults) {
    const systemPrompt = await this._buildSystemPrompt(input);
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Сообщение пользователя: ${input.message}\n\nРезультаты поиска:\n${searchResults}\n\nОтветь пользователю на основе результатов поиска. Ответ должен быть на русском языке.`,
      },
    ];

    try {
      const response = await this.llmProvider.complete({
        messages,
        temperature: 0.7,
        maxTokens: 1024,
      });

      return response.content;
    } catch (err) {
      logger.error({ err }, 'Failed to generate search reply');
      return 'Извините, произошла ошибка при обработке результатов поиска.';
    }
  }
}

export default AIBrain;
