import pino from 'pino';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import config from './config.js';
import database from './database.js';
import { WhatsAppBot, MessageHandler } from './bot/index.js';
import { llmProvider, AIBrain } from './ai/index.js';
import { ShortTermMemory, LongTermMemory, ContextCompressor } from './memory/index.js';
import Scheduler from './scheduler/index.js';
import WebServer from './web/index.js';

const logger = pino({ name: 'app' });

/**
 * Application entry point.
 * Initialises all subsystems in the correct order.
 */
async function main() {
  logger.info('========================================');
  logger.info('  WhatsApp AI Group Assistant starting');
  logger.info('========================================');
  logger.info({ config: {
    port: config.port,
    llmProvider: config.llmProvider,
    model: config.googleModel,
    timezone: config.botTimezone,
    activityLevel: config.botActivityLevel,
    nodeEnv: config.nodeEnv,
  } }, 'Configuration');

  // Ensure data directories exist
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  if (!existsSync(config.sessionDir)) {
    mkdirSync(config.sessionDir, { recursive: true });
  }

  // Auto-create .env from .env.example if missing
  const envPath = join(config.dataDir, '..', '.env');
  const envExamplePath = join(config.dataDir, '..', '.env.example');
  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    logger.info('Created .env from .env.example — please update with your API keys');
  }

  // 1. Initialize database (await async init)
  await database.waitReady();
  logger.info('Database initialized');

  // 2. Initialize memory system
  const shortTerm = new ShortTermMemory();
  const compressor = new ContextCompressor(llmProvider);
  const longTerm = new LongTermMemory(shortTerm, compressor);
  logger.info('Memory system initialized');

  // 3. Initialize AI Brain
  const aiBrain = new AIBrain(llmProvider, longTerm);
  logger.info('AI Brain initialized');

  // 4. Initialize scheduler
  const scheduler = new Scheduler();
  scheduler.start();
  logger.info('Scheduler started');

  // 5. Initialize WhatsApp bot
  const whatsappBot = new WhatsAppBot();
  logger.info('WhatsApp bot instance created');

  // 6. Initialize message handler (connects bot ↔ AI)
  const messageHandler = new MessageHandler(
    whatsappBot,
    aiBrain,
    shortTerm,
    longTerm,
    scheduler
  );
  logger.info('Message handler initialized');

  // 7. Initialize web server
  const webServer = new WebServer({
    whatsappBot,
    aiBrain,
    shortTermMemory: shortTerm,
    longTermMemory: longTerm,
    scheduler,
  });

  // 8. Start web server
  await webServer.start(config.port);

  // 9. Start WhatsApp connection
  logger.info('Starting WhatsApp connection...');
  whatsappBot.start().catch((err) => {
    logger.error({ err }, 'Failed to start WhatsApp bot');
  });

  // Log startup
  database.logActivity('bot_started', {
    version: '1.0.0',
    nodeVersion: process.version,
    timezone: config.botTimezone,
    activityLevel: config.botActivityLevel,
  });

  logger.info('========================================');
  logger.info('  System ready!');
  logger.info(`  Admin panel: http://localhost:${config.port}`);
  logger.info('========================================');

  // Graceful shutdown handler
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    scheduler.stop();
    webServer.stop();

    if (whatsappBot.isConnected()) {
      await whatsappBot.logout();
    }

    database.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
