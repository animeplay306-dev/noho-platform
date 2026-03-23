/**
 * NOHO Core Library v2.0
 * The Brain - AI-Powered Backend Core
 * Lines: 500+
 * Responsibility: Logic, AI, Data Management
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class NOHOLibrary extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      aiKey: config.aiKey || process.env.OPENAI_KEY || 'sk-proj-default',
      dbPath: config.dbPath || './noho_data',
      maxPagesPerUser: config.maxPages || 10,
      rateLimit: config.rateLimit || 100,
      ...config
    };
    
    this.users = new Map();
    this.pages = new Map();
    this.sessions = new Map();
    this.apiKeys = new Map();
    this.analytics = new Map();
    
    this.init();
  }

  async init() {
    await this.ensureDataDir();
    await this.loadData();
    this.startCleanupInterval();
    console.log('[NOHO-LIB] Core initialized');
  }

  // ===== DATA PERSISTENCE =====
  async ensureDataDir() {
    try {
      await fs.mkdir(this.config.dbPath, { recursive: true });
      await fs.mkdir(path.join(this.config.dbPath, 'users'), { recursive: true });
      await fs.mkdir(path.join(this.config.dbPath, 'pages'), { recursive: true });
    } catch (e) {
      console.error('[NOHO-LIB] Data dir error:', e);
    }
  }

  async loadData() {
    try {
      const files = await fs.readdir(path.join(this.config.dbPath, 'users'));
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await fs.readFile(path.join(this.config.dbPath, 'users', file), 'utf8');
          const user = JSON.parse(data);
          this.users.set(user.id, user);
          if (user.apiKey) this.apiKeys.set(user.apiKey, user.id);
        }
      }
      console.log(`[NOHO-LIB] Loaded ${this.users.size} users`);
    } catch (e) {
      console.log('[NOHO-LIB] No existing data');
    }
  }

  async saveUser(userId) {
    const user = this.users.get(userId);
    if (!user) return;
    const filePath = path.join(this.config.dbPath, 'users', `${userId}.json`);
    await fs.writeFile(filePath, JSON.stringify(user, null, 2));
  }

  async savePage(pageId, data) {
    const filePath = path.join(this.config.dbPath, 'pages', `${pageId}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  // ===== USER MANAGEMENT =====
  generateId() {
    return crypto.randomUUID();
  }

  generateApiKey() {
    const prefix = 'noho';
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(random + timestamp).digest('hex').substring(0, 24);
    return `${prefix}_${timestamp}_${hash}`;
  }

  generateToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  async registerUser(email, password, username) {
    // Validation
    if (!email || !password || !username) {
      throw new Error('Missing required fields');
    }
    
    if (password.length < 8) {
      throw new Error('Password must be 8+ characters');
    }

    // Check existing
    for (const [_, user] of this.users) {
      if (user.email === email) throw new Error('Email exists');
      if (user.username === username) throw new Error('Username taken');
    }

    const userId = this.generateId();
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const apiKey = this.generateApiKey();
    
    const user = {
      id: userId,
      email,
      username,
      password: hashedPassword,
      apiKey,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      pages: [],
      stats: {
        requests: 0,
        pagesCreated: 0,
        lastActive: Date.now()
      },
      settings: {
        autoFix: true,
        notifications: true,
        theme: 'dark'
      }
    };

    this.users.set(userId, user);
    this.apiKeys.set(apiKey, userId);
    await this.saveUser(userId);
    
    this.emit('user:registered', { userId, email });
    return { userId, apiKey, username };
  }

  async loginUser(email, password) {
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    
    for (const [_, user] of this.users) {
      if (user.email === email && user.password === hashedPassword) {
        const token = this.generateToken();
        user.lastLogin = new Date().toISOString();
        user.stats.lastActive = Date.now();
        
        this.sessions.set(token, {
          userId: user.id,
          createdAt: Date.now(),
          expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24h
        });
        
        await this.saveUser(user.id);
        this.emit('user:login', { userId: user.id });
        return { token, user: this.sanitizeUser(user) };
      }
    }
    throw new Error('Invalid credentials');
  }

  validateToken(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return this.users.get(session.userId);
  }

  getUserByApiKey(apiKey) {
    const userId = this.apiKeys.get(apiKey);
    return userId ? this.users.get(userId) : null;
  }

  sanitizeUser(user) {
    const { password, ...safe } = user;
    return safe;
  }

  // ===== AI INTEGRATION =====
  async analyzeCode(code, context = 'general') {
    if (!this.config.aiKey || this.config.aiKey === 'sk-proj-default') {
      return { fixed: code, warnings: ['AI not configured'], changes: [] };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.aiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: `You are NOHO Code Guardian. Analyze JavaScript code for:
1. Security vulnerabilities (eval, innerHTML, XSS)
2. Infinite loops or blocking operations
3. Memory leaks
4. Syntax errors
5. Rate limiting violations
Return JSON format: { fixed: "code", warnings: [], changes: ["description"] }`
            },
            {
              role: "user",
              content: `Context: ${context}\nCode:\n${code}`
            }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result;
    } catch (error) {
      console.error('[NOHO-LIB] AI Error:', error);
      return { fixed: code, warnings: ['AI analysis failed'], changes: [] };
    }
  }

  async generatePageCode(description, userId) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.aiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "Generate a complete HTML page with embedded CSS and JS based on user description. Return only the HTML code."
            },
            {
              role: "user",
              content: `Create a web page for: ${description}`
            }
          ],
          temperature: 0.7
        })
      });

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      throw new Error('AI generation failed');
    }
  }

  // ===== PAGE MANAGEMENT =====
  async createPage(userId, route, code, options = {}) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    if (user.pages.length >= this.config.maxPagesPerUser) {
      throw new Error(`Maximum ${this.config.maxPagesPerUser} pages allowed`);
    }

    // Validate route
    if (!route.startsWith('/')) route = '/' + route;
    if (!/^[a-zA-Z0-9\-\/\_]+$/.test(route)) {
      throw new Error('Invalid route format');
    }

    const pageId = `${userId}_${crypto.randomBytes(8).toString('hex')}`;
    const fullRoute = `/${user.username}${route}`;
    
    // AI Analysis
    let finalCode = code;
    let analysis = { warnings: [], changes: [] };
    
    if (user.settings.autoFix && this.config.aiKey !== 'sk-proj-default') {
      analysis = await this.analyzeCode(code, `page:${route}`);
      finalCode = analysis.fixed;
    }

    const page = {
      id: pageId,
      userId,
      route: fullRoute,
      shortRoute: route,
      code: finalCode,
      originalCode: code,
      analysis,
      options: {
        public: options.public !== false,
        allowApi: options.allowApi !== false,
        ...options
      },
      stats: {
        views: 0,
        lastAccessed: null,
        createdAt: new Date().toISOString()
      }
    };

    this.pages.set(pageId, page);
    user.pages.push(pageId);
    user.stats.pagesCreated++;
    
    await this.savePage(pageId, page);
    await this.saveUser(userId);
    
    this.emit('page:created', { pageId, userId, route: fullRoute });
    return page;
  }

  getPage(pageId) {
    return this.pages.get(pageId);
  }

  getPageByRoute(route) {
    for (const [_, page] of this.pages) {
      if (page.route === route) return page;
    }
    return null;
  }

  async deletePage(userId, pageId) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    const page = this.pages.get(pageId);
    if (!page || page.userId !== userId) throw new Error('Page not found');

    this.pages.delete(pageId);
    user.pages = user.pages.filter(id => id !== pageId);
    
    await this.saveUser(userId);
    try {
      await fs.unlink(path.join(this.config.dbPath, 'pages', `${pageId}.json`));
    } catch (e) {}
    
    return true;
  }

  // ===== ANALYTICS =====
  trackRequest(userId, type) {
    const user = this.users.get(userId);
    if (user) {
      user.stats.requests++;
      user.stats.lastActive = Date.now();
      this.saveUser(userId);
    }
  }

  trackPageView(pageId) {
    const page = this.pages.get(pageId);
    if (page) {
      page.stats.views++;
      page.stats.lastAccessed = new Date().toISOString();
      this.savePage(pageId, page);
    }
  }

  getUserStats(userId) {
    const user = this.users.get(userId);
    if (!user) return null;
    
    const pageDetails = user.pages.map(pid => {
      const p = this.pages.get(pid);
      return p ? { id: p.id, route: p.route, views: p.stats.views } : null;
    }).filter(Boolean);

    return {
      ...user.stats,
      pages: pageDetails,
      totalPages: user.pages.length
    };
  }

  // ===== MAINTENANCE =====
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      // Cleanup expired sessions
      for (const [token, session] of this.sessions) {
        if (now > session.expiresAt) {
          this.sessions.delete(token);
        }
      }
    }, 60000); // Every minute
  }

  // ===== UTILITIES =====
  async regenerateApiKey(userId) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');

    // Remove old key mapping
    this.apiKeys.delete(user.apiKey);
    
    // Generate new
    const newKey = this.generateApiKey();
    user.apiKey = newKey;
    this.apiKeys.set(newKey, userId);
    
    await this.saveUser(userId);
    return newKey;
  }

  updateUserSettings(userId, settings) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');
    
    user.settings = { ...user.settings, ...settings };
    this.saveUser(userId);
    return user.settings;
  }

  listUsers() {
    return Array.from(this.users.values()).map(u => this.sanitizeUser(u));
  }
}

module.exports = NOHOLibrary;
