import axios from 'axios';
import pino from 'pino';
import database from '../database.js';

const logger = pino({ name: 'tavily' });

/**
 * Tavily Search API integration.
 * Used by the AI brain to search for real-time information and images.
 */
class TavilyClient {
  constructor() {
    this.apiKey = null;
    this.baseUrl = 'https://api.tavily.com';
  }

  /**
   * Get the API key from memory or database.
   * @returns {string|null}
   */
  async _getApiKey() {
    if (this.apiKey) return this.apiKey;
    this.apiKey = await database.getSetting('tavily_api_key');
    return this.apiKey || null;
  }

  /**
   * Update the API key.
   * @param {string} key
   */
  async setApiKey(key) {
    this.apiKey = key;
    await database.setSetting('tavily_api_key', key);
    logger.info('Tavily API key updated');
  }

  /**
   * Check if Tavily is configured.
   * @returns {boolean}
   */
  async isConfigured() {
    const key = await this._getApiKey();
    return !!key && key.length > 0;
  }

  /**
   * Search for information using Tavily.
   * @param {string} query - Search query
   * @param {object} [options]
   * @param {number} [options.maxResults] - Max results (default: 5)
   * @param {boolean} [options.includeImages] - Include image results
   * @param {string} [options.searchDepth] - "basic" or "advanced"
   * @returns {Promise<object>} Search results
   */
  async search(query, options = {}) {
    const apiKey = await this._getApiKey();
    if (!apiKey) {
      throw new Error('Tavily API key not configured');
    }

    const {
      maxResults = 5,
      includeImages = true,
      searchDepth = 'basic',
    } = options;

    try {
      logger.info({ query, maxResults }, 'Tavily search');

      const response = await axios.post(`${this.baseUrl}/search`, {
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_images: includeImages,
        search_depth: searchDepth,
        include_answer: true,
        include_raw_content: false,
      });

      const data = response.data;

      const result = {
        query: data.query,
        answer: data.answer || '',
        results: (data.results || []).map((r) => ({
          title: r.title || '',
          url: r.url || '',
          content: r.content || '',
          score: r.score || 0,
        })),
        images: (data.images || []).map((img) => ({
          url: img.url || img,
          description: img.description || '',
        })),
        responseTime: data.response_time || 0,
      };

      logger.info(`Tavily search returned ${result.results.length} results, ${result.images.length} images`);

      database.logActivity('tavily_search', {
        query,
        resultsCount: result.results.length,
        imagesCount: result.images.length,
      }).catch(() => {});

      return result;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      logger.error({ err, query }, `Tavily search failed: ${errorMsg}`);
      throw new Error(`Tavily search error: ${errorMsg}`);
    }
  }

  /**
   * Search specifically for images.
   * @param {string} query
   * @param {number} [maxResults]
   * @returns {Promise<string[]>} Image URLs
   */
  async searchImages(query, maxResults = 3) {
    const result = await this.search(query, {
      maxResults,
      includeImages: true,
      searchDepth: 'basic',
    });
    return result.images.map((img) => img.url);
  }

  /**
   * Format search results as a readable string for the AI.
   * @param {object} searchResult
   * @returns {string}
   */
  formatResultsForPrompt(searchResult) {
    if (!searchResult || !searchResult.results?.length) {
      return 'Поиск не дал результатов.';
    }

    const parts = [];

    if (searchResult.answer) {
      parts.push(`📝 Краткий ответ: ${searchResult.answer}`);
    }

    parts.push('📚 Результаты поиска:');
    for (const r of searchResult.results) {
      parts.push(`  • ${r.title}: ${r.content}`);
    }

    if (searchResult.images?.length) {
      parts.push('🖼️ Изображения:');
      for (const img of searchResult.images) {
        parts.push(`  • ${img.url}`);
      }
    }

    return parts.join('\n');
  }
}

// Singleton
const tavilyClient = new TavilyClient();
export default tavilyClient;
