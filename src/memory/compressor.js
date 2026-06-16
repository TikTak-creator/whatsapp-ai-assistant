import pino from 'pino';
import config from '../config.js';

const logger = pino({ name: 'memory-compressor' });

/**
 * Compresses context when token limit is exceeded.
 * Extracts: important events, user styles, key facts, memes/patterns.
 */
class ContextCompressor {
  /**
   * @param {import('../ai/provider.js').LLMProvider} llmProvider
   */
  constructor(llmProvider) {
    this.llmProvider = llmProvider;
  }

  /**
   * Summarize a set of messages into compressed context.
   * @param {object[]} messages - Array of message objects
   * @param {object} [options]
   * @param {number} [options.targetTokens] - Target token count for compression
   * @returns {Promise<object>} Compressed memory object
   */
  async compress(messages, options = {}) {
    const targetTokens = options.targetTokens || config.compressedTargetTokens;

    logger.info(`Compressing ${messages.length} messages to ~${targetTokens} tokens...`);

    // Format messages for summarization
    const chatHistory = messages
      .map((m) => {
        const sender = m.senderName || m.sender || 'unknown';
        return `[${m.timestamp || ''}] ${sender}: ${m.content || ''}`;
      })
      .join('\n');

    // Truncate if too long for the summarization prompt
    const truncated = chatHistory.length > 100000
      ? chatHistory.slice(-100000)
      : chatHistory;

    const prompt = `Ты — система сжатия контекста. Проанализируй историю чата и верни ТОЛЬКО JSON без markdown-разметки.

Проанализируй следующие сообщения и извлеки:

1. **summary** — краткое содержание (1-2 абзаца, что происходило)
2. **important_events** — список важных событий, решений, договорённостей
3. **user_styles** — как каждый пользователь общается (стиль, тон, интересы)
4. **key_facts** — ключевые факты, которые нужно помнить (имена, даты, планы)
5. **patterns** — повторяющиеся паттерны, мемы, шутки, темы

История чата:
---
${truncated}
---

Ответь строго в формате JSON:
{
  "summary": "...",
  "important_events": ["...", "..."],
  "user_styles": {"username": "стиль пользователя", ...},
  "key_facts": ["...", "..."],
  "patterns": ["...", "..."]
}`;

    try {
      const response = await this.llmProvider.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 4000,
      });

      // Parse JSON from response
      const content = response.content || response;
      let parsed;

      try {
        // Try direct parse first
        parsed = JSON.parse(content);
      } catch {
        // Try to extract JSON from markdown or text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse JSON from LLM response');
        }
      }

      const compressed = {
        summary: parsed.summary || '',
        events: parsed.important_events || [],
        userStyles: parsed.user_styles || {},
        keyFacts: parsed.key_facts || [],
        patterns: parsed.patterns || [],
        tokenCount: Math.ceil(JSON.stringify(parsed).length / 3.5),
        compressedAt: new Date().toISOString(),
      };

      logger.info(`Compression complete: ${compressed.tokenCount} tokens`);
      return compressed;
    } catch (err) {
      logger.error({ err }, 'Compression failed');
      // Fallback: return basic summary
      return {
        summary: `История из ${messages.length} сообщений (ошибка сжатия)`,
        events: [],
        userStyles: {},
        keyFacts: [],
        patterns: [],
        tokenCount: 0,
        compressedAt: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Format compressed memory into a context string for the AI.
   * @param {object} compressedMemory
   * @returns {string}
   */
  formatMemoryForPrompt(compressedMemory) {
    if (!compressedMemory) return '';

    const parts = [];

    if (compressedMemory.summary) {
      parts.push(`=== ДОЛГОВРЕМЕННАЯ ПАМЯТЬ (сводка) ===\n${compressedMemory.summary}`);
    }

    if (compressedMemory.events?.length) {
      parts.push(`=== ВАЖНЫЕ СОБЫТИЯ ===\n${compressedMemory.events.map((e) => `• ${e}`).join('\n')}`);
    }

    if (compressedMemory.keyFacts?.length) {
      parts.push(`=== КЛЮЧЕВЫЕ ФАКТЫ ===\n${compressedMemory.keyFacts.map((f) => `• ${f}`).join('\n')}`);
    }

    if (compressedMemory.patterns?.length) {
      parts.push(`=== ПАТТЕРНЫ ===\n${compressedMemory.patterns.map((p) => `• ${p}`).join('\n')}`);
    }

    if (compressedMemory.userStyles && Object.keys(compressedMemory.userStyles).length > 0) {
      const styles = Object.entries(compressedMemory.userStyles)
        .map(([user, style]) => `• ${user}: ${style}`)
        .join('\n');
      parts.push(`=== СТИЛЬ ПОЛЬЗОВАТЕЛЕЙ ===\n${styles}`);
    }

    return parts.join('\n\n');
  }
}

export default ContextCompressor;
