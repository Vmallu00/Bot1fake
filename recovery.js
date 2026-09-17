'use strict';

const database = require('./database');

class RecoveryManager {
  constructor(manager) {
    this.manager = manager;
    this.timers = new Map();
  }

  log(bot, message) {
    if (bot && typeof bot.log === 'function') {
      bot.log(`[Recovery] ${message}`);
    }
  }

  getBuildsForBot(botId) {
    const builds = database.listBuilds();

    return builds.filter(
      build =>
        String(build.botId) === String(botId) &&
        !['completed', 'cancelled'].includes(
          String(build.status || '').toLowerCase()
        )
    );
  }

  getBotState(botId) {
    const bot = this.manager.get(botId);

    if (!bot) {
      return null;
    }

    return {
      id: bot.id,
      username: bot.username,
      connected: Boolean(bot.bot),
      spawned: Boolean(bot.spawned),
      registered: Boolean(bot.registered),
      cooped: Boolean(bot.cooped),
      flight: Boolean(bot.flight),
      building: Boolean(bot.building),
      buildPaused: Boolean(bot.buildPaused),
      targetUsername: bot.targetUsername || null,
      status: typeof bot.getStatus === 'function'
        ? bot.getStatus()
        : null
    };
  }

  recoverBot(bot) {
    if (!bot) {
      return;
    }

    const builds = this.getBuildsForBot(bot.id);

    this.log(
      bot,
      `Found ${builds.length} unfinished build(s).`
    );

    for (const build of builds) {
      /*
       * Do not immediately start building.
       *
       * The bot must first:
       * - connect
       * - authenticate
       * - enter SkyBlock
       * - complete co-op
       * - visit the target island
       * - obtain/enable flight
       *
       * bot.startBuild() will perform the required
       * validation before actually starting.
       */
      if (
        typeof bot.queueBuildRecovery === 'function'
      ) {
        bot.queueBuildRecovery(build);
      } else {
        this.log(
          bot,
          `Queued unfinished build: ${build.name || build.id}`
        );
      }
    }
  }

  recoverAll() {
    for (const bot of this.manager.values()) {
      this.recoverBot(bot);
    }
  }

  scheduleBotRecovery(
    botId,
    delay = 5000
  ) {
    if (this.timers.has(botId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(botId);

      const bot =
        this.manager.get(botId);

      if (!bot) {
        return;
      }

      this.recoverBot(bot);
    }, delay);

    this.timers.set(botId, timer);
  }

  cancelBotRecovery(botId) {
    const timer =
      this.timers.get(botId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timers.delete(botId);
  }

  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  /*
   * Called after a successful reconnect/spawn.
   */
  async onBotReady(bot) {
    if (!bot) {
      return;
    }

    this.log(
      bot,
      'Bot is ready; checking unfinished builds.'
    );

    const builds =
      this.getBuildsForBot(bot.id);

    if (!builds.length) {
      return;
    }

    /*
     * Prefer the currently active build.
     */
    const active =
      builds.find(
        build =>
          build.status === 'building' ||
          build.status === 'paused' ||
          build.status === 'waiting-materials' ||
          build.status === 'blocked'
      ) || builds[0];

    if (
      typeof bot.resumeBuild === 'function'
    ) {
      try {
        await bot.resumeBuild(active);
      } catch (err) {
        this.log(
          bot,
          `Build recovery paused: ${err.message}`
        );
      }
    }
  }

  saveDisconnectState(bot, reason) {
    if (!bot) {
      return;
    }

    const builds =
      this.getBuildsForBot(bot.id);

    for (const build of builds) {
      const updated = {
        ...build,

        status:
          build.status === 'completed'
            ? 'completed'
            : 'offline',

        offlineReason:
          reason || 'Minecraft connection lost',

        updatedAt:
          new Date().toISOString()
      };

      database.saveBuild(updated);
    }

    this.log(
      bot,
      `Saved recovery state for ${builds.length} build(s).`
    );
  }

  getRecoverySummary(botId) {
    const builds =
      this.getBuildsForBot(botId);

    return builds.map(build => ({
      id: build.id,
      name: build.name,
      status: build.status,
      placedBlocks:
        Number(build.placedBlocks || 0),
      totalBlocks:
        Number(build.totalBlocks || 0),
      progress:
        Number(build.progress || 0),
      currentBlock:
        build.currentBlock || null,
      updatedAt:
        build.updatedAt || null,
      offlineReason:
        build.offlineReason || null
    }));
  }
}

module.exports = RecoveryManager;
