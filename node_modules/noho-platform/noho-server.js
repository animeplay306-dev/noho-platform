/**
 * NOHO Server v3.2 - Express v5 Final Fix
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const NOHOLibrary = require('./noho-lib');

class NOHOServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 5000,
      host: config.host || '0.0.0.0',
      ...config
    };
    
    this.lib = new NOHOLibrary(config);
    this.app = express();
    this.server = null;
    this.wss = null;
    this.clients = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  setupMiddleware() {
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        }
      }
    }));

    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use('/static', express.static('public'));
    
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: (req) => req.user ? 100 : 30,
      message: { error: 'Too many requests' },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use('/api/', limiter);

    this.app.use(this.extractAuth.bind(this));
  }

  extractAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.token || 
                  req.query.token;
    
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (token) {
      req.user = this.lib.validateToken(token);
      if (req.user) req.authType = 'session';
    }
    
    if (apiKey && !req.user) {
      req.user = this.lib.getUserByApiKey(apiKey);
      if (req.user) req.authType = 'apikey';
    }

    next();
  }

  requireAuth(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: this.lib.users.size,
        pages: this.lib.pages.size,
        uptime: process.uptime()
      });
    });

    this.app.post('/api/auth/register', async (req, res) => {
      try {
        const { email, password, username } = req.body;
        const result = await this.lib.registerUser(email, password, username);
        res.status(201).json({
          success: true,
          message: 'User created',
          data: {
            userId: result.userId,
            apiKey: result.apiKey,
            username: result.username
          }
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/auth/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const result = await this.lib.loginUser(email, password);
        res.json({
          success: true,
          token: result.token,
          user: result.user
        });
      } catch (error) {
        res.status(401).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/auth/logout', this.requireAuth, (req, res) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) this.lib.sessions.delete(token);
      res.json({ success: true });
    });

    this.app.get('/api/auth/me', this.requireAuth, (req, res) => {
      res.json({
        success: true,
        user: this.lib.sanitizeUser(req.user),
        stats: this.lib.getUserStats(req.user.id)
      });
    });

    this.app.post('/api/auth/regenerate-key', this.requireAuth, async (req, res) => {
      try {
        const newKey = await this.lib.regenerateApiKey(req.user.id);
        res.json({ success: true, apiKey: newKey });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/pages', this.requireAuth, async (req, res) => {
      try {
        const { route, code, options } = req.body;
        
        if (!route || !code) {
          return res.status(400).json({ error: 'Route and code required' });
        }

        const page = await this.lib.createPage(req.user.id, route, code, options);
        
        res.status(201).json({
          success: true,
          page: {
            id: page.id,
            route: page.route,
            shortRoute: page.shortRoute,
            createdAt: page.stats.createdAt,
            analysis: page.analysis
          }
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/pages', this.requireAuth, (req, res) => {
      const userPages = req.user.pages.map(pid => {
        const p = this.lib.pages.get(pid);
        return p ? {
          id: p.id,
          route: p.route,
          views: p.stats.views,
          createdAt: p.stats.createdAt,
          public: p.options.public
        } : null;
      }).filter(Boolean);
      
      res.json({ success: true, pages: userPages });
    });

    this.app.get('/api/pages/:pageId', this.requireAuth, (req, res) => {
      const page = this.lib.pages.get(req.params.pageId);
      if (!page || page.userId !== req.user.id) {
        return res.status(404).json({ error: 'Page not found' });
      }
      
      res.json({
        success: true,
        page: {
          ...page,
          code: undefined,
          originalCode: undefined
        }
      });
    });

    this.app.delete('/api/pages/:pageId', this.requireAuth, async (req, res) => {
      try {
        await this.lib.deletePage(req.user.id, req.params.pageId);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/ai/analyze', this.requireAuth, async (req, res) => {
      try {
        const { code, context } = req.body;
        const result = await this.lib.analyzeCode(code, context);
        res.json({ success: true, ...result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/ai/generate', this.requireAuth, async (req, res) => {
      try {
        const { description } = req.body;
        const code = await this.lib.generatePageCode(description, req.user.id);
        res.json({ success: true, code });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== PUBLIC PAGE SERVING - REGEXP FIX =====
    // استخدام RegExp بدلاً من wildcard
    this.app.get(/^\/u\/([^\/]+)\/(.+)$/, async (req, res) => {
      try {
        const username = req.params[0];
        const pagePath = req.params[1];
        const route = `/${username}/${pagePath}`;
        
        const page = this.lib.getPageByRoute(route);
        
        if (!page) {
          return res.status(404).send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
              <meta charset="UTF-8">
              <title>404 - NOHO</title>
              <style>
                body { font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc; }
                h1 { font-size: 72px; margin: 0; color: #6366f1; }
                a { color: #6366f1; text-decoration: none; }
                code { background: #1e293b; padding: 4px 8px; border-radius: 4px; }
              </style>
            </head>
            <body>
              <h1>404</h1>
              <p>الصفحة غير موجودة</p>
              <p><code>${route}</code></p>
              <p><a href="/">العودة للرئيسية</a></p>
            </body>
            </html>
          `);
        }

        if (!page.options.public) {
          return res.status(403).send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head><title>403 - Private</title></head>
            <body style="text-align:center; padding:50px; font-family:sans-serif;">
              <h1>🔒 صفحة خاصة</h1>
            </body>
            </html>
          `);
        }

        await this.lib.trackPageView(page.id);

        const sandbox = {
          req, res,
          console,
          setTimeout, setInterval, clearTimeout, clearInterval,
          Date, Math, JSON, Object, Array, String, Number, Boolean, Promise,
          fetch: fetch,
          Buffer, 
          process: { env: {} }
        };
        
        const fn = new Function(...Object.keys(sandbox), `
          "use strict";
          return (async () => {
            ${page.code}
          })();
        `);
        
        await fn(...Object.values(sandbox));
        
      } catch (error) {
        console.error(`[PAGE ERROR]`, error);
        res.status(500).send(`
          <!DOCTYPE html>
          <html dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>Error - NOHO</title>
            <style>
              body { font-family: system-ui; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc; }
              .error-box { color: #ef4444; background: #1e293b; padding: 20px; border-radius: 8px; display: inline-block; margin-top: 20px; }
            </style>
          </head>
          <body>
            <h1 style="color: #ef4444;">⚠️ خطأ في تنفيذ الصفحة</h1>
            <div class="error-box">${error.message}</div>
          </body>
          </html>
        `);
      }
    });

    this.app.get('/api/admin/users', this.requireAuth, (req, res) => {
      if (req.user.email !== 'admin@noho.local') {
        return res.status(403).json({ error: 'Admin only' });
      }
      res.json({ users: this.lib.listUsers() });
    });

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'noho-dashboard.html'));
    });

    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    this.app.use((err, req, res, next) => {
      console.error('[SERVER ERROR]', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  setupWebSocket() {
    this.wss = new WebSocket.Server({ noServer: true });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = crypto.randomUUID();
      this.clients.set(clientId, { ws, authenticated: false });
      
      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data);
          
          if (msg.type === 'auth') {
            const user = this.lib.validateToken(msg.token) || 
                        this.lib.getUserByApiKey(msg.apiKey);
            if (user) {
              this.clients.get(clientId).authenticated = true;
              this.clients.get(clientId).userId = user.id;
              ws.send(JSON.stringify({ type: 'auth_success', user: this.lib.sanitizeUser(user) }));
            } else {
              ws.send(JSON.stringify({ type: 'auth_failed' }));
            }
          }
          else if (msg.type === 'analyze_code' && this.clients.get(clientId).authenticated) {
            const result = await this.lib.analyzeCode(msg.code, msg.context);
            ws.send(JSON.stringify({ type: 'analysis_result', ...result }));
          }
          else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
          
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
      });
    });
  }

  handleUpgrade(request, socket, head) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  async start() {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.server = http.createServer(this.app);
    this.server.on('upgrade', this.handleUpgrade.bind(this));
    
    this.server.listen(this.config.port, this.config.host, () => {
      console.log(`
╔════════════════════════════════════════╗
║           NOHO SERVER v3.2             ║
║      (Express v5 Compatible)           ║
╠════════════════════════════════════════╣
║  HTTP:  http://${this.config.host}:${this.config.port}        ║
║  WS:    ws://${this.config.host}:${this.config.port}          ║
║  Pages: /u/username/page-name          ║
╚════════════════════════════════════════╝
      `);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('[SERVER] Stopped');
    }
  }
}

if (require.main === module) {
  const server = new NOHOServer({
    port: process.env.PORT || 5000,
    aiKey: process.env.OPENAI_KEY
  });
  server.start();
}

module.exports = NOHOServer;

