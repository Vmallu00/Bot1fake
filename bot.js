const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const EventEmitter = require('events');

const database = require('./database');

const {
  GoalNear,
  GoalBlock
} = goals;

class SkyBot extends EventEmitter {
  constructor(options, emitCallback) {
    super();

    this.id = options.id || options.username;
    this.username = options.username;

    this.host =
      options.host ||
      process.env.MC_HOST ||
      'mc.fakepixel.me';

    this.port =
      Number(
        options.port ||
        process.env.MC_PORT ||
        25565
      );

    this.password =
      options.password ||
      process.env.MC_PASSWORD ||
      '';

    this.auth =
      options.auth ||
      'offline';

    this.targetUsername =
      this.normalizeUsername(
        options.targetUsername ||
        process.env.TARGET_USERNAME ||
        'V_Mallu_Gamer'
      );

    this.bot = null;
    this.mcData = null;
    this.movements = null;

    this.connected = false;
    this.spawned = false;
    this.starting = false;
    this.reconnecting = false;

    this.registered = false;
    this.skyblock = false;
    this.cooped = false;
    this.flight = false;

    this.status = 'offline';

    this.position = null;

    this.currentBuild = null;
    this.building = false;
    this.buildPaused = false;
    this.buildCancelled = false;

    this.authSent = false;
    this.skyblockSent = false;
    this.visitSent = false;

    this.startupTimer = null;
    this.reconnectTimer = null;
    this.afkTimer = null;

    this.chatHistory = [];

    this.pendingCoopRequests = new Map();
    this.pendingTrades = new Map();

    this.emitCallback =
      typeof emitCallback === 'function'
        ? emitCallback
        : () => {};

    this.loadSavedState();
  }


  /* =====================================================
     Helpers
  ===================================================== */

  normalizeUsername(username) {
    return String(username || '')
      .trim()
      .replace(/\s+/g, '_');
  }

  log(message, extra = {}) {
    const data = {
      botId: this.id,
      username: this.username,
      message: String(message),
      time: new Date().toISOString(),
      ...extra
    };

    console.log(
      `[${this.username}] ${message}`
    );

    this.emitCallback('log', data);
    this.emit('log', data);
  }

  state(extra = {}) {
    const data = {
      botId: this.id,
      username: this.username,
      connected: this.connected,
      spawned: this.spawned,
      reconnecting: this.reconnecting,
      status: this.status,
      skyblock: this.skyblock,
      cooped: this.cooped,
      flight: this.flight,
      registered: this.registered,
      building: this.building,
      buildPaused: this.buildPaused,
      position: this.position,
      currentBuild: this.currentBuild,
      ...extra
    };

    this.emitCallback('state', data);
    this.emit('state', data);

    this.persistBotState();

    return data;
  }

  loadSavedState() {
    try {
      const saved =
        database.getBot(this.id);

      if (!saved) {
        return;
      }

      this.registered =
        !!saved.registered;

      this.targetUsername =
        this.normalizeUsername(
          saved.targetUsername ||
          this.targetUsername
        );

      this.skyblock =
        !!saved.skyblock;

      this.cooped =
        !!saved.cooped;

      this.flight =
        !!saved.flight;

      this.currentBuild =
        saved.currentBuild ||
        null;
    } catch (error) {
      console.error(
        `[${this.username}] Failed loading state:`,
        error.message
      );
    }
  }

  persistBotState() {
    try {
      database.saveBot(this.id, {
        id: this.id,
        username: this.username,
        host: this.host,
        port: this.port,

        connected: this.connected,
        spawned: this.spawned,

        registered: this.registered,
        skyblock: this.skyblock,
        cooped: this.cooped,
        flight: this.flight,

        targetUsername:
          this.targetUsername,

        status: this.status,

        position: this.position,

        currentBuild:
          this.currentBuild,

        updatedAt: Date.now()
      });
    } catch (error) {
      console.error(
        `[${this.username}] State save failed:`,
        error.message
      );
    }
  }


  /* =====================================================
     Connection
  ===================================================== */

  connect() {
    if (this.starting) {
      this.log(
        'Connection already starting'
      );

      return;
    }

    if (this.bot) {
      this.log(
        'Bot connection already exists'
      );

      return;
    }

    this.starting = true;
    this.reconnecting = false;
    this.status = 'connecting';

    this.state();

    this.log(
      `Connecting to ${this.host}:${this.port} as ${this.username}`
    );

    try {
      this.bot = mineflayer.createBot({
        host: this.host,
        port: this.port,
        username: this.username,

        /*
         * FakePixel uses its server-side
         * authentication system.
         */
        auth: this.auth,

        version: '1.8.9',

        checkTimeoutInterval: 60000,

        hideErrors: false
      });

      this.installPlugins();
      this.installEvents();
    } catch (error) {
      this.starting = false;
      this.bot = null;

      this.status = 'offline';

      this.log(
        `Connection error: ${error.message}`
      );

      this.scheduleReconnect();
    }
  }

  installPlugins() {
    if (!this.bot) {
      return;
    }

    try {
      this.bot.loadPlugin(pathfinder);
    } catch (error) {
      this.log(
        `Pathfinder plugin error: ${error.message}`
      );
    }
  }


  /* =====================================================
     Minecraft Events
  ===================================================== */

  installEvents() {
    const bot = this.bot;

    if (!bot) {
      return;
    }

    bot.once('login', () => {
      this.log('Minecraft login complete');

      this.status = 'logging-in';

      this.state();
    });


    bot.once('spawn', () => {
      this.connected = true;
      this.spawned = true;
      this.starting = false;

      this.status = 'online';

      this.log('Spawned');

      this.setupMovements();
      this.startPositionWatcher();
      this.startAntiAfk();

      this.state();

      /*
       * Wait for FakePixel's server-side
       * authentication screen before sending
       * /register or /login.
       */
      this.clearStartupTimer();

      this.startupTimer =
        setTimeout(() => {
          this.authenticate();
        }, 1800);
    });


    bot.on('message', message => {
      const text =
        this.messageToText(message);

      if (!text) {
        return;
      }

      this.handleChat(text);
    });


    bot.on('chat', (username, message) => {
      this.handleChat(
        `${username}: ${message}`
      );
    });


    bot.on('whisper', (username, message) => {
      this.handleWhisper(
        username,
        message
      );
    });


    bot.on('kicked', reason => {
      const text =
        this.messageToText(reason);

      this.log(
        `Kicked: ${text || 'Unknown reason'}`
      );

      this.status = 'kicked';

      this.cleanupConnection();

      this.scheduleReconnect();
    });


    bot.on('end', reason => {
      this.log(
        `Disconnected${reason ? `: ${reason}` : ''}`
      );

      this.cleanupConnection();

      this.scheduleReconnect();
    });


    bot.on('error', error => {
      this.log(
        `Minecraft error: ${error.message}`
      );

      this.emitCallback('error', {
        botId: this.id,
        username: this.username,
        error: error.message
      });
    });


    bot.on('death', () => {
      this.log('Bot died');

      this.status = 'dead';

      this.state();
    });


    bot.on('health', () => {
      this.state({
        health: bot.health,
        food: bot.food
      });
    });


    bot.on('move', () => {
      if (!bot.entity?.position) {
        return;
      }

      this.position = {
        x: Number(bot.entity.position.x.toFixed(2)),
        y: Number(bot.entity.position.y.toFixed(2)),
        z: Number(bot.entity.position.z.toFixed(2))
      };
    });


    /*
     * Inventory changes are useful for detecting
     * received materials and Magic Potion trades.
     */
    bot.on('windowOpen', window => {
      this.log(
        `Window opened: ${window.title || 'unknown'}`
      );

      this.inspectOpenWindow(window);
    });


    bot.on('windowClose', () => {
      this.log('Window closed');
    });


    /*
     * Detect a successful login/registration
     * from server messages.
     */
    bot.on('message', message => {
      const text =
        this.messageToText(message)
          .toLowerCase();

      if (
        text.includes('registered successfully') ||
        text.includes('registration successful') ||
        text.includes('already registered')
      ) {
        if (!this.registered) {
          this.registered = true;

          this.log(
            'Registration state saved'
          );

          this.persistBotState();
        }
      }
    });
  }


  messageToText(message) {
    if (!message) {
      return '';
    }

    try {
      if (typeof message === 'string') {
        return message;
      }

      if (typeof message.toString === 'function') {
        return message.toString();
      }
    } catch {}

    return '';
  }


  /* =====================================================
     Authentication
  ===================================================== */

  authenticate() {
    if (!this.bot || !this.spawned) {
      return;
    }

    if (this.authSent) {
      return;
    }

    this.authSent = true;

    const password =
      this.password;

    if (!password) {
      this.log(
        'No MC_PASSWORD configured'
      );

      this.afterAuthentication();

      return;
    }

    if (this.registered) {
      this.log(
        'Sending /login'
      );

      this.send(
        `/login ${password}`
      );
    } else {
      this.log(
        'First join: sending /register'
      );

      this.send(
        `/register ${password} ${password}`
      );
    }

    setTimeout(() => {
      this.afterAuthentication();
    }, 4000);
  }


  afterAuthentication() {
    if (!this.bot || !this.spawned) {
      return;
    }

    if (!this.skyblockSent) {
      this.skyblockSent = true;

      this.log(
        'Entering SkyBlock'
      );

      this.send('/skyblock');

      setTimeout(() => {
        this.resumeStartupFlow();
      }, 5000);

      return;
    }

    this.resumeStartupFlow();
  }


  /* =====================================================
     Startup / Recovery
  ===================================================== */

  resumeStartupFlow() {
    if (!this.bot || !this.spawned) {
      return;
    }

    /*
     * Co-op must be accepted before visiting
     * the target island.
     */
    if (!this.cooped) {
      this.status = 'waiting-coop';

      this.log(
        'Waiting for the expected co-op request'
      );

      this.state();

      /*
       * Do not blindly accept unknown users.
       * Incoming requests are handled by
       * handleCoopRequest().
       */
      return;
    }

    if (!this.visitSent) {
      this.visitSent = true;

      const target =
        this.normalizeUsername(
          this.targetUsername
        );

      this.log(
        `Visiting ${target}`
      );

      this.send(
        `/visit ${target}`
      );

      setTimeout(() => {
        this.afterVisit();
      }, 5000);

      return;
    }

    this.afterVisit();
  }


  afterVisit() {
    if (!this.bot) {
      return;
    }

    /*
     * If flight has already been confirmed,
     * continue with build recovery.
     */
    if (this.flight) {
      this.log(
        'Flight already enabled'
      );

      this.resumeSavedBuild();

      return;
    }

    this.status = 'waiting-trade';

    this.log(
      'Waiting for Magic Potion trade'
    );

    this.state();
  }


  /* =====================================================
     Co-op
  ===================================================== */

  handleCoopRequest(username) {
    const target =
      this.normalizeUsername(username);

    if (!target) {
      return;
    }

    const expected =
      this.normalizeUsername(
        this.targetUsername
      );

    const id =
      `coop_${this.id}_${target}`;

    const request = {
      id,
      botId: this.id,
      username: target,

      expected:
        target.toLowerCase() ===
        expected.toLowerCase(),

      status: 'pending',

      createdAt: Date.now()
    };

    this.pendingCoopRequests.set(
      id,
      request
    );

    database.saveCoopRequest(
      id,
      request
    );

    this.log(
      `Co-op request received from ${target}`
    );

    this.emitCallback(
      'coop',
      request
    );

    this.state({
      pendingCoop: request
    });

    /*
     * Only automatically accept the configured
     * target. Unknown requests remain pending.
     */
    if (request.expected) {
      this.acceptCoop(target);
    }
  }


  acceptCoop(username) {
    const target =
      this.normalizeUsername(username);

    if (!target) {
      return;
    }

    this.log(
      `Accepting co-op request from ${target}`
    );

    /*
     * FakePixel-specific command.
     * The server may use a different command;
     * chat feedback is used to confirm success.
     */
    this.send(
      `/coopaccept ${target}`
    );

    const id =
      `coop_${this.id}_${target}`;

    database.saveCoopRequest(id, {
      botId: this.id,
      username: target,
      status: 'accepting'
    });

    setTimeout(() => {
      this.verifyCoop();
    }, 3000);
  }


  rejectCoop(username) {
    const target =
      this.normalizeUsername(username);

    if (!target) {
      return;
    }

    this.log(
      `Rejecting co-op request from ${target}`
    );

    /*
     * Server command may differ.
     * This command is intentionally isolated
     * so it can be changed for the server.
     */
    this.send(
      `/coopdeny ${target}`
    );
  }


  verifyCoop() {
    if (!this.bot) {
      return;
    }

    /*
     * There is no universal Mineflayer packet
     * that proves a custom server co-op state.
     * We therefore wait for server chat feedback.
     */
    this.status = 'checking-coop';

    this.log(
      'Checking co-op/island access'
    );

    this.send('/island');

    setTimeout(() => {
      if (!this.bot) {
        return;
      }

      /*
       * Marked by handleChat() when the server
       * confirms co-op/island access.
       */
      if (this.cooped) {
        this.status = 'online';

        this.resumeStartupFlow();
      } else {
        this.status = 'waiting-coop';

        this.state();
      }
    }, 2500);
  }


  /* =====================================================
     Chat processing
  ===================================================== */

  handleChat(text) {
    if (!text) {
      return;
    }

    this.chatHistory.push({
      text,
      time: Date.now()
    });

    if (this.chatHistory.length > 100) {
      this.chatHistory.shift();
    }

    this.emitCallback('chat', {
      botId: this.id,
      username: this.username,
      text
    });


    const lower =
      text.toLowerCase();


    /*
     * Login required.
     */
    if (
      lower.includes('please login') ||
      lower.includes('you must login') ||
      lower.includes('/login')
    ) {
      if (this.password) {
        setTimeout(() => {
          if (this.bot) {
            this.send(
              `/login ${this.password}`
            );
          }
        }, 700);
      }
    }


    /*
     * Registration confirmation.
     */
    if (
      lower.includes('registered successfully') ||
      lower.includes('registration successful') ||
      lower.includes('already registered')
    ) {
      this.registered = true;

      this.log(
        'Server confirmed registration'
      );

      this.persistBotState();
    }


    /*
     * Co-op request detection.
     *
     * The exact wording can differ on FakePixel,
     * so several common patterns are handled.
     */
    if (
      lower.includes('coop request') ||
      lower.includes('co-op request') ||
      lower.includes('invited you to a coop') ||
      lower.includes('invited you to a co-op') ||
      lower.includes('wants to add you') ||
      lower.includes('has invited you')
    ) {
      const username =
        this.extractUsernameFromMessage(text);

      if (username) {
        this.handleCoopRequest(username);
      }
    }


    /*
     * Co-op success.
     */
    if (
      lower.includes('joined the coop') ||
      lower.includes('joined the co-op') ||
      lower.includes('you are now a member') ||
      lower.includes('added to the coop') ||
      lower.includes('added to the co-op')
    ) {
      this.cooped = true;

      this.status = 'online';

      this.log(
        'Co-op/island access confirmed'
      );

      this.persistBotState();

      this.resumeStartupFlow();
    }


    /*
     * Island/visit success.
     */
    if (
      lower.includes('teleported') ||
      lower.includes('visiting') ||
      lower.includes('you are visiting') ||
      lower.includes('warp complete')
    ) {
      this.log(
        'Island visit appears to be complete'
      );

      this.afterVisit();
    }


    /*
     * Flight enabled.
     */
    if (
      lower.includes('flight enabled') ||
      lower.includes('you can now fly') ||
      lower.includes('fly mode enabled') ||
      lower.includes('flight has been enabled')
    ) {
      this.flight = true;

      this.log(
        'Flight confirmed'
      );

      this.persistBotState();

      this.resumeSavedBuild();
    }


    /*
     * Trade-related messages.
     */
    if (
      lower.includes('trade') ||
      lower.includes('accepted the trade') ||
      lower.includes('trade completed')
    ) {
      this.handleTradeChat(text);
    }


    /*
     * Build completion.
     */
    if (
      lower.includes('build complete') ||
      lower.includes('building complete')
    ) {
      this.finishCurrentBuild();
    }


    /*
     * Generic server error.
     */
    if (
      lower.includes('you cannot do that') ||
      lower.includes('not enough') ||
      lower.includes('unknown command') ||
      lower.includes('no permission')
    ) {
      this.log(
        `Server response: ${text}`
      );
    }
  }


  extractUsernameFromMessage(text) {
    /*
     * Minecraft usernames commonly contain
     * letters, numbers and underscores.
     */
    const matches =
      String(text).match(
        /[A-Za-z0-9_]{3,16}/g
      );

    if (!matches) {
      return null;
    }

    const ignored = new Set([
      'coop',
      'request',
      'co-op',
      'invited',
      'invite',
      'wants',
      'added',
      'trade',
      'server',
      'you',
      'have',
      'been',
      'now'
    ]);

    for (const value of matches) {
      if (
        !ignored.has(
          value.toLowerCase()
        )
      ) {
        return this.normalizeUsername(value);
      }
    }

    return null;
  }


  handleWhisper(username, message) {
    this.log(
      `[PM] ${username}: ${message}`
    );

    this.handleChat(
      `${username}: ${message}`
    );
  }


  /* =====================================================
     Commands
  ===================================================== */

  send(command) {
    if (!this.bot) {
      this.log(
        `Cannot send command while offline: ${command}`
      );

      return false;
    }

    const text =
      String(command || '').trim();

    if (!text) {
      return false;
    }

    try {
      /*
       * Accept both:
       * /command args
       * command args
       */
      const finalCommand =
        text.startsWith('/')
          ? text
          : `/${text}`;

      this.bot.chat(
        finalCommand
      );

      this.log(
        `> ${finalCommand}`
      );

      return true;
    } catch (error) {
      this.log(
        `Command error: ${error.message}`
      );

      return false;
    }
  }


  handleTagCommand(commandLine) {
    const line =
      String(commandLine || '')
        .trim();

    if (!line) {
      return;
    }

    const parts =
      line.split(/\s+/);

    const command =
      parts.shift()
        ?.toLowerCase();

    switch (command) {
      case 'status':
        this.sendStatus();

        break;

      case 'pos':
        this.sendPosition();

        break;

      case 'say':
        this.send(
          `say ${parts.join(' ')}`
        );

        break;

      case 'come':
        this.comeToPlayer(
          parts[0]
        );

        break;

      case 'stop':
        this.stopMovement();

        break;

      case 'follow':
        this.followPlayer(
          parts[0]
        );

        break;

      case 'join':
        this.interactNpc(
          parts.join(' '),
          'right'
        );

        break;

      case 'leave':
        this.send('island');

        break;

      case 'restart':
        this.reconnect();

        break;

      case 'reconnect':
        this.reconnect();

        break;

      case 'afk':
        this.startAntiAfk();

        break;

      case 'unafk':
        this.stopAntiAfk();

        break;

      case 'cm':
        this.send(
          parts.join(' ')
        );

        break;

      case 'build':
        this.commandBuild(parts);

        break;

      case 'done':
        this.checkBuildMaterials();

        break;

      case 'balance':
      case 'bal':
        this.reportBalance();

        break;

      case 'balitems':
        this.reportBalanceItems();

        break;

      case 'res':
      case 'builds':
        this.resumeSavedBuild();

        break;

      case 'trade':
        this.handleTradeCommand(
          parts
        );

        break;

      default:
        this.log(
          `Unknown bot command: ${command}`
        );
    }
  }


  sendStatus() {
    const health =
      this.bot?.health ?? 0;

    const food =
      this.bot?.food ?? 0;

    this.send(
      `say Status: ${this.status} | HP ${health} | Food ${food} | SkyBlock ${this.skyblock} | Co-op ${this.cooped} | Flight ${this.flight}`
    );
  }


  sendPosition() {
    if (!this.position) {
      this.send(
        'say Position unavailable'
      );

      return;
    }

    this.send(
      `say XYZ: ${this.position.x} ${this.position.y} ${this.position.z}`
    );
  }


  /* =====================================================
     Movement
  ===================================================== */

  setupMovements() {
    if (!this.bot) {
      return;
    }

    try {
      this.mcData =
        require('minecraft-data')(
          '1.8.9'
        );

      this.movements =
        new Movements(
          this.bot,
          this.mcData
        );

      this.bot.pathfinder.setMovements(
        this.movements
      );
    } catch (error) {
      this.log(
        `Movement setup error: ${error.message}`
      );
    }
  }


  comeToPlayer(username) {
    if (!this.bot || !username) {
      return;
    }

    const player =
      this.bot.players[username];

    if (!player?.entity) {
      this.log(
        `Player not found: ${username}`
      );

      return;
    }

    try {
      const pos =
        player.entity.position;

      this.bot.pathfinder.setGoal(
        new GoalNear(
          pos.x,
          pos.y,
          pos.z,
          2
        )
      );

      this.log(
        `Moving toward ${username}`
      );
    } catch (error) {
      this.log(
        `Come error: ${error.message}`
      );
    }
  }


  followPlayer(username) {
    if (!this.bot || !username) {
      return;
    }

    const player =
      this.bot.players[username];

    if (!player?.entity) {
      this.log(
        `Player not found: ${username}`
      );

      return;
    }

    try {
      const entity =
        player.entity;

      this.bot.pathfinder.setGoal(
        new GoalNear(
          entity.position.x,
          entity.position.y,
          entity.position.z,
          2
        ),
        true
      );

      this.log(
        `Following ${username}`
      );
    } catch (error) {
      this.log(
        `Follow error: ${error.message}`
      );
    }
  }


  stopMovement() {
    try {
      this.bot?.pathfinder?.setGoal(
        null
      );

      this.log(
        'Movement stopped'
      );
    } catch {}
  }


  /* =====================================================
     NPC
  ===================================================== */

  interactNpc(name, click = 'right') {
    if (!this.bot || !name) {
      return false;
    }

    const target =
      String(name)
        .trim()
        .toLowerCase();

    let closest = null;
    let distance = Infinity;

    for (
      const entity of
      Object.values(this.bot.entities)
    ) {
      if (
        !entity ||
        !entity.name
      ) {
        continue;
      }

      const entityName =
        String(entity.name)
          .toLowerCase();

      if (
        !entityName.includes(target)
      ) {
        continue;
      }

      const d =
        this.bot.entity.position.distanceTo(
          entity.position
        );

      if (d < distance) {
        closest = entity;
        distance = d;
      }
    }

    if (!closest) {
      this.log(
        `NPC not found: ${name}`
      );

      return false;
    }

    try {
      if (click === 'left') {
        this.bot.lookAt(
          closest.position,
          true
        );

        this.bot.attack(closest);
      } else {
        this.bot.lookAt(
          closest.position,
          true
        );

        this.bot.activateEntity(
          closest
        );
      }

      this.log(
        `${click} clicked NPC ${name}`
      );

      return true;
    } catch (error) {
      this.log(
        `NPC interaction error: ${error.message}`
      );

      return false;
    }
  }


  /* =====================================================
     Inventory
  ===================================================== */

  getInventory() {
    if (!this.bot?.inventory) {
      return [];
    }

    return this.bot.inventory.items()
      .map(item => ({
        name: item.name,
        displayName:
          item.displayName ||
          item.name,
        count: item.count,
        slot: item.slot,
        metadata: item.metadata
      }));
  }


  getBalance() {
    const items = {};

    for (const item of this.getInventory()) {
      const key =
        item.displayName ||
        item.name;

      items[key] =
        (items[key] || 0) +
        Number(item.count || 0);
    }

    return {
      items,
      missing: {}
    };
  }


  reportBalance() {
    const balance =
      this.getBalance();

    const entries =
      Object.entries(balance.items);

    if (!entries.length) {
      this.send(
        'say Inventory is empty'
      );

      return;
    }

    const text =
      entries
        .slice(0, 20)
        .map(
          ([name, count]) =>
            `${name} x${count}`
        )
        .join(', ');

    this.send(
      `say ${text}`
    );
  }


  reportBalanceItems() {
    const balance =
      this.getBalance();

    const entries =
      Object.entries(balance.items);

    this.log(
      'Inventory:',
      entries
    );

    return entries;
  }


  inspectOpenWindow(window) {
    if (!window) {
      return;
    }

    try {
      const items =
        window.slots
          ?.filter(Boolean)
          .map(item => ({
            name: item.name,
            displayName:
              item.displayName ||
              item.name,
            count: item.count,
            slot: item.slot
          })) || [];

      this.emitCallback(
        'window',
        {
          botId: this.id,
          title:
            window.title || '',
          items
        }
      );
    } catch {}
  }


  /* =====================================================
     Trade
  ===================================================== */

  handleTradeChat(text) {
    this.log(
      `Trade: ${text}`
    );

    this.emitCallback(
      'trade',
      {
        botId: this.id,
        text,
        time: Date.now()
      }
    );
  }


  handleTradeCommand(parts) {
    const action =
      String(parts[0] || '')
        .toLowerCase();

    if (action === 'approve') {
      const id = parts[1];

      const trade =
        id
          ? database.getTrade(id)
          : null;

      if (trade) {
        this.approveTrade(trade);
      } else {
        this.log(
          'No matching trade found'
        );
      }

      return;
    }

    if (action === 'deny') {
      const id = parts[1];

      const trade =
        id
          ? database.getTrade(id)
          : null;

      if (trade) {
        this.denyTrade(trade);
      }

      return;
    }

    this.log(
      'Trade command: trade approve <id> | trade deny <id>'
    );
  }


  approveTrade(trade) {
    if (!trade) {
      return;
    }

    /*
     * Trade GUI handling is intentionally separated
     * from arbitrary click automation.
     *
     * The server's actual trade window must be
     * inspected before confirming items.
     */
    this.log(
      `Trade approved: ${trade.id}`
    );

    this.pendingTrades.delete(
      trade.id
    );

    database.saveTrade(
      trade.id,
      {
        status: 'approved',
        approvedAt: Date.now()
      }
    );
  }


  denyTrade(trade) {
    if (!trade) {
      return;
    }

    this.log(
      `Trade denied: ${trade.id}`
    );

    this.pendingTrades.delete(
      trade.id
    );

    database.saveTrade(
      trade.id,
      {
        status: 'denied',
        deniedAt: Date.now()
      }
    );
  }


  /* =====================================================
     Building
  ===================================================== */

  async commandBuild(parts) {
    if (parts.length < 4) {
      this.log(
        'Usage: build <schematic> <x> <y> <z>'
      );

      return;
    }

    const schematicName =
      parts[0];

    const x =
      Number(parts[1]);

    const y =
      Number(parts[2]);

    const z =
      Number(parts[3]);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      this.log(
        'Invalid build coordinates'
      );

      return;
    }

    const schematics =
      database.getSchematics();

    const schematic =
      Object.values(schematics)
        .find(s =>
          s.id === schematicName ||
          s.nickname?.toLowerCase() ===
            schematicName.toLowerCase()
        );

    if (!schematic) {
      this.log(
        `Schematic not found: ${schematicName}`
      );

      return;
    }

    const buildId =
      `build_${this.id}_${Date.now()}`;

    const build = {
      id: buildId,
      botId: this.id,

      schematicId:
        schematic.id,

      schematicName:
        schematic.nickname,

      x,
      y,
      z,

      status: 'queued',

      progress: 0,
      placed: 0,

      total:
        schematic.totalBlocks || 0,

      materials:
        schematic.materials || {},

      missingMaterials: {},

      currentBlock: null,

      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    database.saveBuild(
      buildId,
      build
    );

    await this.startBuild(
      build
    );
  }


  async startBuild(build) {
    if (!build) {
      return false;
    }

    if (!this.bot || !this.spawned) {
      this.log(
        'Cannot build while bot is offline'
      );

      return false;
    }

    this.currentBuild =
      build.id;

    this.building = true;
    this.buildPaused = false;
    this.buildCancelled = false;

    database.saveBuild(
      build.id,
      {
        status: 'checking',
        updatedAt: Date.now()
      }
    );

    this.state();

    /*
     * Verify basic world/build conditions
     * before attempting placement.
     */
    if (!this.cooped) {
      this.log(
        'Build paused: co-op/island access not confirmed'
      );

      this.pauseBuild();

      return false;
    }

    if (!this.flight) {
      this.log(
        'Build paused: flight not confirmed'
      );

      this.pauseBuild();

      return false;
    }

    const materialCheck =
      this.checkRequiredMaterials(build);

    if (!materialCheck.complete) {
      database.saveBuild(
        build.id,
        {
          status: 'waiting-materials',
          missingMaterials:
            materialCheck.missing,
          updatedAt: Date.now()
        }
      );

      this.log(
        'Build paused: missing materials'
      );

      this.building = false;

      this.state();

      return false;
    }

    /*
     * Delegate actual schematic placement
     * to builder.js.
     */
    try {
      const builder =
        require('./builder');

      if (
        typeof builder.start ===
        'function'
      ) {
        await builder.start(
          this,
          build
        );

        return true;
      }

      this.log(
        'builder.js does not expose start()'
      );

      this.pauseBuild();

      return false;
    } catch (error) {
      this.log(
        `Builder error: ${error.message}`
      );

      database.saveBuild(
        build.id,
        {
          status: 'error',
          error: error.message
        }
      );

      this.building = false;

      this.state();

      return false;
    }
  }


  checkRequiredMaterials(build) {
    const required =
      build.materials || {};

    const inventory =
      this.getBalance().items;

    const missing = {};
    let complete = true;

    for (
      const [material, amount]
      of Object.entries(required)
    ) {
      const have =
        this.findInventoryMaterial(
          material,
          inventory
        );

      const need =
        Number(amount || 0);

      if (have < need) {
        complete = false;

        missing[material] =
          need - have;
      }
    }

    return {
      complete,
      missing
    };
  }


  findInventoryMaterial(
    material,
    inventory
  ) {
    const wanted =
      String(material)
        .toLowerCase();

    let total = 0;

    for (
      const [name, count]
      of Object.entries(inventory)
    ) {
      if (
        name.toLowerCase()
          .includes(wanted) ||
        wanted.includes(
          name.toLowerCase()
        )
      ) {
        total +=
          Number(count || 0);
      }
    }

    return total;
  }


  checkBuildMaterials() {
    if (!this.currentBuild) {
      this.log(
        'No active build'
      );

      return;
    }

    const build =
      database.getBuild(
        this.currentBuild
      );

    if (!build) {
      this.log(
        'Active build no longer exists'
      );

      return;
    }

    const result =
      this.checkRequiredMaterials(
        build
      );

    database.saveBuild(
      build.id,
      {
        status:
          result.complete
            ? 'ready'
            : 'waiting-materials',

        missingMaterials:
          result.missing,

        updatedAt: Date.now()
      }
    );

    if (result.complete) {
      this.log(
        'All required materials are available'
      );

      if (
        !this.building &&
        this.flight &&
        this.cooped
      ) {
        this.startBuild(build);
      }
    } else {
      this.log(
        `Missing materials: ${JSON.stringify(result.missing)}`
      );
    }

    this.state();
  }


  pauseBuild() {
    this.buildPaused = true;
    this.building = false;

    if (this.currentBuild) {
      database.saveBuild(
        this.currentBuild,
        {
          status: 'paused',
          updatedAt: Date.now()
        }
      );
    }

    this.stopMovement();

    this.state();
  }


  resumeBuild() {
    if (!this.currentBuild) {
      this.resumeSavedBuild();

      return;
    }

    const build =
      database.getBuild(
        this.currentBuild
      );

    if (!build) {
      this.currentBuild = null;

      this.state();

      return;
    }

    this.buildPaused = false;

    this.startBuild(build);
  }


  cancelBuild() {
    this.buildCancelled = true;
    this.building = false;
    this.buildPaused = false;

    if (this.currentBuild) {
      database.saveBuild(
        this.currentBuild,
        {
          status: 'cancelled',
          updatedAt: Date.now()
        }
      );
    }

    this.currentBuild = null;

    this.state();
  }


  finishCurrentBuild() {
    if (!this.currentBuild) {
      return;
    }

    database.saveBuild(
      this.currentBuild,
      {
        status: 'completed',
        progress: 100,
        updatedAt: Date.now()
      }
    );

    this.log(
      'Build completed'
    );

    this.building = false;
    this.buildPaused = false;

    this.currentBuild = null;

    this.state();
  }


  resumeSavedBuild() {
    const builds =
      database.getBuilds();

    const build =
      Object.values(builds)
        .filter(b =>
          b.botId === this.id &&
          [
            'queued',
            'checking',
            'paused',
            'waiting-materials',
            'building'
          ].includes(b.status)
        )
        .sort(
          (a, b) =>
            Number(a.updatedAt || 0) -
            Number(b.updatedAt || 0)
        )
        .pop();

    if (!build) {
      this.log(
        'No unfinished build to resume'
      );

      return;
    }

    this.currentBuild =
      build.id;

    this.log(
      `Resuming build ${build.id}`
    );

    this.startBuild(build);
  }


  /* =====================================================
     Anti-AFK
  ===================================================== */

  startAntiAfk() {
    if (
      String(
        process.env.ANTI_AFK || 'true'
      ).toLowerCase() === 'false'
    ) {
      return;
    }

    this.stopAntiAfk();

    if (!this.bot) {
      return;
    }

    this.afkTimer =
      setInterval(() => {
        if (!this.bot) {
          return;
        }

        try {
          /*
           * Small harmless movement to prevent
           * idle timeout where permitted.
           */
          this.bot.setControlState(
            'jump',
            true
          );

          setTimeout(() => {
            if (this.bot) {
              this.bot.setControlState(
                'jump',
                false
              );
            }
          }, 250);
        } catch {}
      }, 60000);

    this.log(
      'Anti-AFK enabled'
    );
  }


  stopAntiAfk() {
    if (this.afkTimer) {
      clearInterval(
        this.afkTimer
      );

      this.afkTimer = null;
    }

    try {
      this.bot?.setControlState(
        'jump',
        false
      );
    } catch {}
  }


  startPositionWatcher() {
    /*
     * Position is already updated by the
     * mineflayer "move" event.
     */
  }


  /* =====================================================
     Reconnect / Quit
  ===================================================== */

  reconnect() {
    this.log(
      'Reconnecting'
    );

    this.reconnecting = true;

    this.clearStartupTimer();

    if (this.reconnectTimer) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    try {
      this.bot?.quit(
        'Reconnect requested'
      );
    } catch {}

    this.cleanupConnection();

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;

        this.connect();
      }, 1500);
  }


  scheduleReconnect() {
    const enabled =
      String(
        process.env.BOT_RECONNECT || 'true'
      ).toLowerCase() !== 'false';

    if (!enabled) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    const delay =
      Number(
        process.env.BOT_RECONNECT_DELAY ||
        5000
      );

    this.reconnecting = true;

    this.status =
      'reconnecting';

    this.state();

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;

        if (!this.bot) {
          this.connect();
        }
      }, delay);
  }


  quit(reason = 'Quit') {
    this.log(
      `Quitting: ${reason}`
    );

    this.clearStartupTimer();

    if (this.reconnectTimer) {
      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer = null;
    }

    this.stopAntiAfk();

    try {
      this.bot?.quit(reason);
    } catch {}

    this.cleanupConnection(
      false
    );
  }


  cleanupConnection(
    allowReconnect = true
  ) {
    this.clearStartupTimer();

    this.stopAntiAfk();

    this.connected = false;
    this.spawned = false;
    this.starting = false;

    this.status = 'offline';

    this.bot = null;
    this.mcData = null;
    this.movements = null;

    this.authSent = false;
    this.skyblockSent = false;
    this.visitSent = false;

    this.state();

    if (allowReconnect) {
      this.scheduleReconnect();
    }
  }


  clearStartupTimer() {
    if (this.startupTimer) {
      clearTimeout(
        this.startupTimer
      );

      this.startupTimer = null;
    }
  }


  /* =====================================================
     External state helpers
  ===================================================== */

  getState() {
    return {
      id: this.id,
      username: this.username,

      connected:
        this.connected,

      spawned:
        this.spawned,

      status:
        this.status,

      registered:
        this.registered,

      skyblock:
        this.skyblock,

      cooped:
        this.cooped,

      flight:
        this.flight,

      building:
        this.building,

      buildPaused:
        this.buildPaused,

      position:
        this.position,

      currentBuild:
        this.currentBuild,

      targetUsername:
        this.targetUsername
    };
  }
}

module.exports = SkyBot;
