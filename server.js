require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { Server } = require('socket.io');

const database = require('./database');
const BotManager = require('./bot-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || process.env.WEB_PORT || 8000);

const DATA_DIR = database.DATA_DIR;
const SCHEMATICS_DIR = database.SCHEMATICS_DIR;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SCHEMATICS_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));


/* =========================================================
   Authentication
========================================================= */

function checkAuth(req, res, next) {
  const configuredUser = process.env.PANEL_USERNAME || 'vmallu';
  const configuredPassword = process.env.PANEL_PASSWORD || 'vmallu';

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="FakePixel Builder"');
    return res.status(401).send('Authentication required');
  }

  const encoded = auth.slice(6);

  let decoded;

  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return res.status(401).send('Invalid authentication');
  }

  const separator = decoded.indexOf(':');

  if (separator === -1) {
    return res.status(401).send('Invalid authentication');
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (
    username !== configuredUser ||
    password !== configuredPassword
  ) {
    res.setHeader('WWW-Authenticate', 'Basic realm="FakePixel Builder"');
    return res.status(401).send('Invalid username or password');
  }

  next();
}


/*
 * Protect API and panel.
 */
app.use('/api', checkAuth);


/* =========================================================
   Bot Manager
========================================================= */

const manager = new BotManager();

manager.on('log', data => {
  io.emit('log', data);
});

manager.on('state', data => {
  io.emit('state', data);
});

manager.on('error', data => {
  console.error('[BOT ERROR]', data);
  io.emit('error', data);
});

manager.on('build', data => {
  io.emit('build', data);
});


/* =========================================================
   Helpers
========================================================= */

function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function safeName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .replace(/\s+/g, '_');
}

function publicBot(bot) {
  if (!bot) return null;

  return {
    id: bot.id,
    username: bot.username,
    host: bot.host,
    port: bot.port,
    connected: !!bot.connected,
    spawned: !!bot.spawned,
    building: !!bot.building,
    status: bot.status || 'offline',
    position: bot.position || null,
    targetUsername: bot.targetUsername || null,
    registered: !!bot.registered,
    skyblock: !!bot.skyblock,
    cooped: !!bot.cooped,
    flight: !!bot.flight,
    currentBuild: bot.currentBuild || null,
    reconnecting: !!bot.reconnecting
  };
}


/* =========================================================
   Health
========================================================= */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'fakepixel-skyblock-builder',
    time: new Date().toISOString()
  });
});


/* =========================================================
   Main Panel
========================================================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


/* =========================================================
   State
========================================================= */

app.get('/api/state', (req, res) => {
  const state = database.getState();

  const bots = {};

  for (const [id, saved] of Object.entries(state.bots || {})) {
    const live = manager.get(id);

    bots[id] = {
      ...saved,
      ...(live ? publicBot(live) : {}),
      online: !!live?.connected
    };
  }

  res.json({
    ok: true,
    settings: state.settings,
    bots,
    schematics: state.schematics,
    builds: state.builds,
    trades: state.trades,
    coop: state.coop
  });
});


/* =========================================================
   Settings
========================================================= */

app.get('/api/settings', (req, res) => {
  res.json({
    ok: true,
    settings: database.getSettings()
  });
});

app.post('/api/settings', (req, res) => {
  const allowed = {};

  if (req.body.targetUsername !== undefined) {
    allowed.targetUsername = normalizeUsername(
      req.body.targetUsername
    );
  }

  database.saveSettings(allowed);

  res.json({
    ok: true,
    settings: database.getSettings()
  });
});


/* =========================================================
   Bots
========================================================= */

app.get('/api/bots', (req, res) => {
  const savedBots = database.getBots();

  const result = Object.values(savedBots).map(saved => {
    const live = manager.get(saved.id);

    return {
      ...saved,
      ...(live ? publicBot(live) : {}),
      online: !!live?.connected
    };
  });

  res.json({
    ok: true,
    bots: result
  });
});


app.post('/api/bots', (req, res) => {
  const username =
    String(req.body.username || '').trim();

  if (!username) {
    return res.status(400).json({
      ok: false,
      error: 'Bot username is required'
    });
  }

  const id =
    String(req.body.id || username)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');

  const botConfig = {
    id,
    username,
    host:
      req.body.host ||
      process.env.MC_HOST ||
      'mc.fakepixel.me',

    port:
      Number(
        req.body.port ||
        process.env.MC_PORT ||
        25565
      ),

    password:
      req.body.password ||
      process.env.MC_PASSWORD ||
      '',

    auth:
      req.body.auth ||
      'offline',

    targetUsername:
      normalizeUsername(
        req.body.targetUsername ||
        database.getSettings().targetUsername ||
        process.env.TARGET_USERNAME ||
        'V_Mallu_Gamer'
      )
  };

  database.saveBot(id, {
    id,
    username,
    host: botConfig.host,
    port: botConfig.port,

    /*
     * Never expose password through API responses.
     */
    targetUsername: botConfig.targetUsername,

    registered: false,
    connected: false,
    status: 'offline'
  });

  try {
    const bot = manager.add(botConfig);

    bot.connect();

    res.json({
      ok: true,
      bot: publicBot(bot)
    });
  } catch (error) {
    console.error('[BOT CREATE]', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});


app.post('/api/bots/:id/start', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  bot.connect();

  res.json({
    ok: true,
    bot: publicBot(bot)
  });
});


app.post('/api/bots/:id/stop', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  bot.quit('Stopped from web panel');

  res.json({
    ok: true
  });
});


app.post('/api/bots/:id/reconnect', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  bot.reconnect();

  res.json({
    ok: true
  });
});


app.post('/api/bots/:id/command', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  const command = String(req.body.command || '').trim();

  if (!command) {
    return res.status(400).json({
      ok: false,
      error: 'Command is required'
    });
  }

  bot.send(command);

  res.json({
    ok: true
  });
});


app.delete('/api/bots/:id', (req, res) => {
  const id = req.params.id;

  const bot = manager.get(id);

  if (bot) {
    bot.quit('Deleted from web panel');
  }

  manager.remove(id);
  database.deleteBot(id);

  res.json({
    ok: true
  });
});


/* =========================================================
   Schematics
========================================================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, SCHEMATICS_DIR);
  },

  filename: (req, file, cb) => {
    const filename =
      `${Date.now()}_${safeName(file.originalname)}`;

    cb(null, filename);
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 100 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const ext =
      path.extname(file.originalname).toLowerCase();

    if (ext !== '.schem' && ext !== '.schematic') {
      return cb(
        new Error(
          'Only .schem and .schematic files are allowed'
        )
      );
    }

    cb(null, true);
  }
});


app.get('/api/schematics', (req, res) => {
  res.json({
    ok: true,
    schematics: database.getSchematics()
  });
});


app.post(
  '/api/schematics/upload',
  upload.single('schematic'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: 'Schematic file is required'
        });
      }

      const id = makeId('schem');

      const nickname =
        String(
          req.body.nickname ||
          path.basename(
            req.file.originalname,
            path.extname(req.file.originalname)
          )
        ).trim();

      const schematic = {
        id,
        nickname,
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size,
        createdAt: Date.now()
      };

      /*
       * Inspecting is handled by schematic.js.
       * If the parser is available, collect dimensions/materials.
       */
      try {
        const schematicModule = require('./schematic');

        if (typeof schematicModule.inspect === 'function') {
          const info =
            await schematicModule.inspect(req.file.path);

          Object.assign(schematic, info);
        }
      } catch (error) {
        console.log(
          '[SCHEMATIC] Inspection unavailable:',
          error.message
        );
      }

      database.saveSchematic(id, schematic);

      res.json({
        ok: true,
        schematic
      });
    } catch (error) {
      console.error('[SCHEMATIC UPLOAD]', error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


app.delete('/api/schematics/:id', (req, res) => {
  const schematic =
    database.getSchematic(req.params.id);

  if (!schematic) {
    return res.status(404).json({
      ok: false,
      error: 'Schematic not found'
    });
  }

  if (schematic.path) {
    try {
      if (fs.existsSync(schematic.path)) {
        fs.unlinkSync(schematic.path);
      }
    } catch (error) {
      console.error(
        '[SCHEMATIC DELETE]',
        error.message
      );
    }
  }

  database.deleteSchematic(req.params.id);

  res.json({
    ok: true
  });
});


/* =========================================================
   Builds
========================================================= */

app.get('/api/builds', (req, res) => {
  res.json({
    ok: true,
    builds: database.getBuilds()
  });
});


app.post('/api/builds', async (req, res) => {
  try {
    const {
      botId,
      schematicId,
      x,
      y,
      z
    } = req.body;

    if (!botId) {
      return res.status(400).json({
        ok: false,
        error: 'botId is required'
      });
    }

    if (!schematicId) {
      return res.status(400).json({
        ok: false,
        error: 'schematicId is required'
      });
    }

    const schematic =
      database.getSchematic(schematicId);

    if (!schematic) {
      return res.status(404).json({
        ok: false,
        error: 'Schematic not found'
      });
    }

    const bot = manager.get(botId);

    if (!bot) {
      return res.status(404).json({
        ok: false,
        error: 'Bot not found'
      });
    }

    const coords = {
      x: Number(x),
      y: Number(y),
      z: Number(z)
    };

    if (
      !Number.isFinite(coords.x) ||
      !Number.isFinite(coords.y) ||
      !Number.isFinite(coords.z)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid X, Y or Z coordinates'
      });
    }

    const id = makeId('build');

    const build = {
      id,
      botId,
      schematicId,

      schematicName: schematic.nickname,

      x: coords.x,
      y: coords.y,
      z: coords.z,

      status: 'queued',

      progress: 0,
      placed: 0,
      total: schematic.totalBlocks || 0,

      materials: schematic.materials || {},

      missingMaterials: {},

      currentBlock: null,

      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    database.saveBuild(id, build);

    if (typeof bot.startBuild === 'function') {
      await bot.startBuild(build);
    }

    res.json({
      ok: true,
      build: database.getBuild(id)
    });
  } catch (error) {
    console.error('[BUILD CREATE]', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});


app.post('/api/builds/:id/pause', (req, res) => {
  const build =
    database.getBuild(req.params.id);

  if (!build) {
    return res.status(404).json({
      ok: false,
      error: 'Build not found'
    });
  }

  const bot = manager.get(build.botId);

  if (bot?.pauseBuild) {
    bot.pauseBuild();
  }

  database.saveBuild(build.id, {
    status: 'paused'
  });

  res.json({
    ok: true,
    build: database.getBuild(build.id)
  });
});


app.post('/api/builds/:id/resume', (req, res) => {
  const build =
    database.getBuild(req.params.id);

  if (!build) {
    return res.status(404).json({
      ok: false,
      error: 'Build not found'
    });
  }

  const bot = manager.get(build.botId);

  if (bot?.resumeBuild) {
    bot.resumeBuild();
  }

  database.saveBuild(build.id, {
    status: 'queued'
  });

  res.json({
    ok: true,
    build: database.getBuild(build.id)
  });
});


app.post('/api/builds/:id/cancel', (req, res) => {
  const build =
    database.getBuild(req.params.id);

  if (!build) {
    return res.status(404).json({
      ok: false,
      error: 'Build not found'
    });
  }

  const bot = manager.get(build.botId);

  if (bot?.cancelBuild) {
    bot.cancelBuild();
  }

  database.saveBuild(build.id, {
    status: 'cancelled'
  });

  res.json({
    ok: true,
    build: database.getBuild(build.id)
  });
});


app.delete('/api/builds/:id', (req, res) => {
  const build =
    database.getBuild(req.params.id);

  if (!build) {
    return res.status(404).json({
      ok: false,
      error: 'Build not found'
    });
  }

  const bot = manager.get(build.botId);

  if (bot?.cancelBuild) {
    bot.cancelBuild();
  }

  database.deleteBuild(build.id);

  res.json({
    ok: true
  });
});


/* =========================================================
   Material / Balance
========================================================= */

app.get('/api/bots/:id/balance', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  const balance =
    typeof bot.getBalance === 'function'
      ? bot.getBalance()
      : {
          items: {},
          missing: {}
        };

  res.json({
    ok: true,
    balance
  });
});


app.get('/api/bots/:id/inventory', (req, res) => {
  const bot = manager.get(req.params.id);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  const inventory =
    typeof bot.getInventory === 'function'
      ? bot.getInventory()
      : [];

  res.json({
    ok: true,
    inventory
  });
});


/* =========================================================
   Co-op
========================================================= */

app.get('/api/coop', (req, res) => {
  res.json({
    ok: true,
    coop: database.getCoop()
  });
});


app.post('/api/coop/:id/accept', (req, res) => {
  const request =
    database.getCoopRequest(req.params.id);

  if (!request) {
    return res.status(404).json({
      ok: false,
      error: 'Co-op request not found'
    });
  }

  const bot = manager.get(request.botId);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  if (typeof bot.acceptCoop === 'function') {
    bot.acceptCoop(request.username);
  } else {
    bot.send(`/coopaccept ${request.username}`);
  }

  database.saveCoopRequest(request.id, {
    status: 'accepting'
  });

  res.json({
    ok: true
  });
});


app.post('/api/coop/:id/reject', (req, res) => {
  const request =
    database.getCoopRequest(req.params.id);

  if (!request) {
    return res.status(404).json({
      ok: false,
      error: 'Co-op request not found'
    });
  }

  const bot = manager.get(request.botId);

  if (bot?.rejectCoop) {
    bot.rejectCoop(request.username);
  }

  database.saveCoopRequest(request.id, {
    status: 'rejected'
  });

  res.json({
    ok: true
  });
});


/* =========================================================
   Trade
========================================================= */

app.get('/api/trades', (req, res) => {
  res.json({
    ok: true,
    trades: database.getTrades()
  });
});


app.post('/api/trades/:id/approve', (req, res) => {
  const trade =
    database.getTrade(req.params.id);

  if (!trade) {
    return res.status(404).json({
      ok: false,
      error: 'Trade not found'
    });
  }

  const bot = manager.get(trade.botId);

  if (!bot) {
    return res.status(404).json({
      ok: false,
      error: 'Bot not found'
    });
  }

  if (typeof bot.approveTrade === 'function') {
    bot.approveTrade(trade);
  }

  database.saveTrade(trade.id, {
    status: 'approved'
  });

  res.json({
    ok: true
  });
});


app.post('/api/trades/:id/deny', (req, res) => {
  const trade =
    database.getTrade(req.params.id);

  if (!trade) {
    return res.status(404).json({
      ok: false,
      error: 'Trade not found'
    });
  }

  const bot = manager.get(trade.botId);

  if (bot?.denyTrade) {
    bot.denyTrade(trade);
  }

  database.saveTrade(trade.id, {
    status: 'denied'
  });

  res.json({
    ok: true
  });
});


/* =========================================================
   Socket.IO
========================================================= */

io.on('connection', socket => {
  socket.emit('state', {
    settings: database.getSettings(),
    bots: database.getBots(),
    schematics: database.getSchematics(),
    builds: database.getBuilds(),
    trades: database.getTrades(),
    coop: database.getCoop()
  });

  socket.on('command', data => {
    if (!data || !data.botId || !data.command) {
      return;
    }

    const bot = manager.get(data.botId);

    if (!bot) {
      return;
    }

    bot.send(String(data.command).trim());
  });
});


/* =========================================================
   Error handling
========================================================= */

app.use((error, req, res, next) => {
  console.error('[SERVER ERROR]', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    ok: false,
    error: error.message || 'Internal server error'
  });
});


/* =========================================================
   Start
========================================================= */

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==========================================');
  console.log('   FakePixel SkyBlock Builder');
  console.log('==========================================');
  console.log(`Web server: http://0.0.0.0:${PORT}`);
  console.log(`Minecraft: ${process.env.MC_HOST || 'mc.fakepixel.me'}:${process.env.MC_PORT || 25565}`);
  console.log('==========================================');
  console.log('');
});


/* =========================================================
   Load saved bots
========================================================= */

try {
  const savedBots = database.getBots();

  for (const bot of Object.values(savedBots)) {
    if (!bot || !bot.id || !bot.username) {
      continue;
    }

    try {
      manager.add({
        id: bot.id,
        username: bot.username,
        host: bot.host || process.env.MC_HOST || 'mc.fakepixel.me',
        port: bot.port || process.env.MC_PORT || 25565,
        password:
          process.env.MC_PASSWORD || '',
        auth: bot.auth || 'offline',
        targetUsername:
          bot.targetUsername ||
          process.env.TARGET_USERNAME ||
          'V_Mallu_Gamer'
      });
    } catch (error) {
      console.error(
        `[BOT LOAD] ${bot.id}:`,
        error.message
      );
    }
  }
} catch (error) {
  console.error(
    '[BOT LOAD]',
    error.message
  );
}
