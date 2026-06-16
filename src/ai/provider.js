import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import config from '../config.js';

const logger = pino({ name: 'llm-provider' });

/**
 * LLM Provider — Google AI (Gemini / Gemma models).
 * Uses the @google/generative-ai SDK.
 */
class LLMProvider {
  constructor() {
    this.client = null;
    this.model = config.googleModel || 'gemma-4-31b-it';
    this.provider = config.llmProvider;

    if (config.googleApiKey) {
      this.init();
    }
  }

  init() {
    if (this.provider === 'google') {
      this.client = new GoogleGenerativeAI(config.googleApiKey);
      logger.info(`LLM Provider initialized: ${this.provider} (model: ${this.model})`);
    }
  }

  /**
   * Check if the provider is configured.
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.client;
  }

  /**
   * Convert messages array to Google AI content format.
   * Google AI uses { role, parts: [{ text }] } format.
   * @param {object[]} messages - Array of {role, content}
   * @returns {{ systemInstruction?: string, contents: object[] }}
   */
  _formatMessages(messages) {
    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        // Map role: 'user' → 'user', 'assistant' → 'model'
        const googleRole = msg.role === 'assistant' ? 'model' : 'user';
        contents.push({
          role: googleRole,
          parts: [{ text: msg.content }],
        });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Send a completion request to Google AI.
   * @param {object} params
   * @param {object[]} params.messages - Array of {role, content} messages
   * @param {number} [params.temperature] - Temperature (0-2)
   * @param {number} [params.maxTokens] - Max output tokens
   * @param {boolean} [params.jsonMode] - Force JSON response format
   * @returns {Promise<object>} Response with content
   */
  async complete({ messages, temperature = 0.7, maxTokens = 2048, jsonMode = false }) {
    if (!this.client) {
      throw new Error('LLM provider not configured. Set GOOGLE_API_KEY in .env');
    }

    try {
      const { systemInstruction, contents } = this._formatMessages(messages);

      // Build generation config
      const generationConfig = {
        temperature,
        maxOutputTokens: maxTokens,
      };

      // Google AI supports JSON mode via responseMimeType
      if (jsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }

      // Get the generative model
      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: systemInstruction || undefined,
        generationConfig,
      });

      // Generate content
      const result = await model.generateContent({ contents });
      const response = result.response;

      const content = response.text();
      const usage = {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      };

      logger.debug(
        { totalTokens: usage.totalTokens, model: this.model },
        'LLM completion'
      );

      return {
        content,
        model: this.model,
        usage,
      };
    } catch (err) {
      logger.error({ err }, 'Google AI completion failed');

      // Enhanced error message for common issues
      const msg = err.message || '';
      if (msg.includes('API key')) {
        throw new Error('Google AI: Invalid or missing API key. Check GOOGLE_API_KEY in .env');
      }
      if (msg.includes('not found')) {
        throw new Error(`Google AI: Model "${this.model}" not found or not available with this API key`);
      }
      if (msg.includes('quota') || msg.includes('rate')) {
        throw new Error('Google AI: Rate limit or quota exceeded');
      }

      throw new Error(`Google AI error: ${err.message}`);
    }
  }
}

// Singleton
const llmProvider = new LLMProvider();
export default llmProvider;
