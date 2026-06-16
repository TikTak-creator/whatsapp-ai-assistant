import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import config from '../config.js';
import createApiRouter from '../api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = pino({ name: 'web-server' });

/**
 * Creates and configures the web admin panel server.
 */
class WebServer {
  /**
   * @param {object} services
   * @param {import('../bot/whatsapp.js').default} services.whatsappBot
   * @param {import('../ai/brain.js').default} services.aiBrain
   * @param {import('../memory/shortTerm.js').default} services.shortTermMemory
   * @param {import('../memory/longTerm.js').default} services.longTermMemory
   * @param {import('../scheduler/index.js').default} services.scheduler
   */
  constructor(services) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.services = services;
    this.publicDir = join(__dirname, 'public');

    this._configureMiddleware();
    this._configureRoutes();
    this._configureSocketIO();
  }

  _configureMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Auth middleware — checks cookie or Basic auth
    this.app.use((req, res, next) => {
      // Skip auth for login page and static assets
      if (req.path === '/login' || req.path.startsWith('/api/auth/')) {
        return next();
      }

      // Check cookie
      const token = req.headers.cookie?.match(/auth_token=([^;]+)/)?.[1];
      if (token === 'admin') {
        return next();
      }

      // Check Basic auth
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Basic ')) {
        const base64 = auth.split(' ')[1];
        const [username, password] = Buffer.from(base64, 'base64').toString().split(':');
        if (username === config.adminUsername && password === config.adminPassword) {
          return next();
        }
      }

      // If it's an API request, return 401
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // For page requests, redirect to login
      res.redirect('/login');
    });
  }

  _configureRoutes() {
    // API routes
    this.app.use('/api', createApiRouter(
      this.services.whatsappBot,
      this.services.aiBrain,
      this.services.shortTermMemory,
      this.services.longTermMemory,
      this.services.scheduler
    ));      // Auth page
    this.app.get('/login', (req, res) => {
      const token = req.headers.cookie?.match(/auth_token=([^;]+)/)?.[1];
      if (token === 'admin') {
        return res.redirect('/');
      }
      res.sendFile(join(this.publicDir, 'login.html'));
    });

    // Serve static files
    this.app.use(express.static(this.publicDir));

    // Fallback to index.html for SPA-like routing
    this.app.get('/', (req, res) => {
      res.sendFile(join(this.publicDir, 'index.html'));
    });

    // Dashboard page
    this.app.get('/dashboard', (req, res) => {
      res.sendFile(join(this.publicDir, 'dashboard.html'));
    });

    // Settings page
    this.app.get('/settings', (req, res) => {
      res.sendFile(join(this.publicDir, 'settings.html'));
    });

    // Memory page
    this.app.get('/memory', (req, res) => {
      res.sendFile(join(this.publicDir, 'memory.html'));
    });

    // Scheduler page
    this.app.get('/scheduler', (req, res) => {
      res.sendFile(join(this.publicDir, 'scheduler.html'));
    });

    // Logs page
    this.app.get('/logs', (req, res) => {
      res.sendFile(join(this.publicDir, 'logs.html'));
    });
  }

  _configureSocketIO() {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Send initial status
      socket.emit('status', {
        connected: this.services.whatsappBot.isConnected(),
        state: this.services.whatsappBot.getStatus(),
        qr: this.services.whatsappBot.getQR(),
        botJid: this.services.whatsappBot.getBotJid(),
        uptime: process.uptime(),
      });

      // Handle client requests
      socket.on('get:status', () => {
        socket.emit('status', {
          connected: this.services.whatsappBot.isConnected(),
          state: this.services.whatsappBot.getStatus(),
          qr: this.services.whatsappBot.getQR(),
          botJid: this.services.whatsappBot.getBotJid(),
          uptime: process.uptime(),
        });
      });

      socket.on('get:memory', (jid) => {
        const info = this.services.longTermMemory?.getMemoryInfo(jid || 'default');
        socket.emit('memory', info);
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });

    // Set up real-time status broadcasting
    this.services.whatsappBot.setOnConnectionUpdate((state) => {
      this.io.emit('status', {
        connected: state === 'open',
        state,
        qr: state === 'open' ? null : this.services.whatsappBot.getQR(),
        botJid: this.services.whatsappBot.getBotJid(),
        uptime: process.uptime(),
      });
    });

    this.services.whatsappBot.setOnQRUpdate((qr) => {
      this.io.emit('qr', { qr, connected: false });
      this.io.emit('status', {
        connected: false,
        state: 'qr_received',
        qr,
        botJid: null,
        uptime: process.uptime(),
      });
    });
  }

  /**
   * Start the web server.
   * @param {number} [port]
   * @returns {Promise<void>}
   */
  start(port) {
    return new Promise((resolve) => {
      const listenPort = port || config.port;
      this.server.listen(listenPort, () => {
        logger.info(`Admin panel available at http://localhost:${listenPort}`);
        resolve();
      });
    });
  }

  /**
   * Stop the web server.
   */
  stop() {
    this.io.close();
    this.server.close();
  }
}

export default WebServer;
