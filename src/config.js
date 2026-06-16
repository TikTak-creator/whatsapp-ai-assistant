import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database — PostgreSQL (Render)
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',

  // LLM Provider — Google AI
  llmProvider: process.env.LLM_PROVIDER || 'google',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  googleModel: process.env.GOOGLE_MODEL || 'gemma-4-31b-it',

  // Tavily
  tavilyApiKey: process.env.TAVILY_API_KEY || '',

  // Redis (optional)
  redisUrl: process.env.REDIS_URL || '',

  // Bot
  botNickname: process.env.BOT_NICKNAME || 'AI Assistant',
  botActivityLevel: process.env.BOT_ACTIVITY_LEVEL || 'medium',
  botTimezone: process.env.BOT_TIMEZONE || 'Asia/Bishkek',

  // Admin
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // Paths
  sessionDir: process.env.SESSION_DIR || join(__dirname, '..', 'data', 'sessions'),
  dataDir: join(__dirname, '..', 'data'),

  // Memory limits
  shortTermLimit: 500,
  maxContextTokens: 256000,
  compressedTargetTokens: 40000,
};

export default config;
