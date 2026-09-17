const EventEmitter = require('events');
const SkyBot = require('./bot');

class BotManager extends EventEmitter {
  constructor() {
    super();

    this.bots = new Map();
  }

  add(options) {
    const id =
      String(options.id || options.username)
        .trim();

    if (!id) {
      throw new Error('Bot ID is required');
    }

    /*
     * Prevent duplicate bot instances.
     */
    if (this.bots.has(id)) {
      return this.bots.get(id);
    }

    const bot = new SkyBot(
      {
        ...options,
        id
      },
      (event, data) => {
        this.emit(event, data);
      }
    );

    this.bots.set(id, bot);

    return bot;
  }

  get(id) {
    if (!id) return null;

    return this.bots.get(String(id)) || null;
  }

  has(id) {
    return this.bots.has(String(id));
  }

  remove(id) {
    const key = String(id);

    const bot = this.bots.get(key);

    if (!bot) {
      return false;
    }

    try {
      if (typeof bot.quit === 'function') {
        bot.quit('Removed from bot manager');
      }
    } catch (error) {
      console.error(
        `[BOT MANAGER] Failed to quit ${key}:`,
        error.message
      );
    }

    this.bots.delete(key);

    return true;
  }

  list() {
    return Array.from(this.bots.values());
  }

  values() {
    return this.bots.values();
  }

  size() {
    return this.bots.size;
  }

  connectAll() {
    for (const bot of this.bots.values()) {
      try {
        bot.connect();
      } catch (error) {
        console.error(
          `[BOT MANAGER] Failed to connect ${bot.id}:`,
          error.message
        );
      }
    }
  }

  disconnectAll(reason = 'Manager shutdown') {
    for (const bot of this.bots.values()) {
      try {
        bot.quit(reason);
      } catch (error) {
        console.error(
          `[BOT MANAGER] Failed to disconnect ${bot.id}:`,
          error.message
        );
      }
    }
  }
}

module.exports = BotManager;
