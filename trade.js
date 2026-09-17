'use strict';

const database = require('./database');

const MAGIC_POTION_NAMES = [
  'magic_potion',
  'magic potion',
  'flight_potion',
  'flight potion'
];

function normalizeName(name) {
  if (!name) return '';

  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^minecraft:/, '')
    .replace(/_/g, ' ');
}

function isMagicPotion(name) {
  const normalized = normalizeName(name);

  return MAGIC_POTION_NAMES.some(
    value => normalizeName(value) === normalized
  );
}

function inventorySnapshot(bot) {
  if (!bot || !bot.inventory) {
    return [];
  }

  return bot.inventory.items().map(item => ({
    name: item.name,
    displayName: item.displayName || item.name,
    count: item.count || 0,
    type: item.type,
    metadata: item.metadata
  }));
}

function findItem(bot, name) {
  if (!bot || !bot.inventory) {
    return null;
  }

  const wanted = normalizeName(name);

  return bot.inventory.items().find(item => {
    return normalizeName(item.name) === wanted ||
      normalizeName(item.displayName) === wanted;
  }) || null;
}

function countItem(bot, name) {
  const wanted = normalizeName(name);

  return bot.inventory.items()
    .filter(item =>
      normalizeName(item.name) === wanted ||
      normalizeName(item.displayName) === wanted
    )
    .reduce((total, item) => total + (item.count || 0), 0);
}

function findMagicPotion(bot) {
  if (!bot || !bot.inventory) {
    return null;
  }

  return bot.inventory.items().find(item => {
    return isMagicPotion(item.name) ||
      isMagicPotion(item.displayName);
  }) || null;
}

function createTrade({
  botId,
  trader,
  expectedItems = [],
  purpose = 'materials'
}) {
  const trade = {
    id: `trade_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,

    botId,
    trader: trader || null,

    expectedItems: Array.isArray(expectedItems)
      ? expectedItems
      : [],

    purpose,

    status: 'pending',

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    verified: false,
    accepted: false,
    completed: false
  };

  database.saveTrade(trade);

  return trade;
}

function getTrade(id) {
  return database.getTrade(id);
}

function listTrades(botId) {
  const trades = database.listTrades();

  if (!botId) {
    return trades;
  }

  return trades.filter(
    trade => String(trade.botId) === String(botId)
  );
}

function verifyExpectedItems(bot, expectedItems) {
  const expected = Array.isArray(expectedItems)
    ? expectedItems
    : [];

  const results = [];
  let valid = true;

  for (const requirement of expected) {
    const name = requirement.name ||
      requirement.item ||
      requirement.displayName;

    const required = Math.max(
      1,
      Number(requirement.count || requirement.amount || 1)
    );

    const received = countItem(bot, name);

    const ok = received >= required;

    if (!ok) {
      valid = false;
    }

    results.push({
      name,
      required,
      received,
      ok
    });
  }

  return {
    valid,
    items: results
  };
}

/*
 * Trade GUI handling is intentionally separated from the bot.
 *
 * FakePixel's exact trade GUI/window layout can change, so this module
 * does not blindly click arbitrary inventory slots.
 *
 * The bot should call verifyTrade() after the server opens a trade.
 */
function verifyTrade(bot, trade) {
  if (!bot || !trade) {
    throw new Error('Bot or trade is missing.');
  }

  if (trade.status !== 'pending' &&
      trade.status !== 'open') {
    return {
      valid: false,
      reason: `Trade is already ${trade.status}.`
    };
  }

  const result = verifyExpectedItems(
    bot.bot || bot,
    trade.expectedItems
  );

  trade.verified = result.valid;
  trade.verification = result;
  trade.updatedAt = new Date().toISOString();

  if (!result.valid) {
    trade.status = 'waiting-items';
  } else {
    trade.status = 'verified';
  }

  database.saveTrade(trade);

  return result;
}

function verifyMagicPotion(bot) {
  const minecraftBot = bot.bot || bot;

  const potion = findMagicPotion(minecraftBot);

  return {
    found: Boolean(potion),
    item: potion
      ? {
          name: potion.name,
          displayName: potion.displayName,
          count: potion.count
        }
      : null
  };
}

async function consumeMagicPotion(bot) {
  const minecraftBot = bot.bot || bot;

  if (!minecraftBot) {
    throw new Error('Minecraft bot is not connected.');
  }

  const potion = findMagicPotion(minecraftBot);

  if (!potion) {
    throw new Error('Magic Potion was not found in inventory.');
  }

  /*
   * Do not blindly use an unknown item.
   * Only the known Magic Potion names are accepted.
   */
  if (
    !isMagicPotion(potion.name) &&
    !isMagicPotion(potion.displayName)
  ) {
    throw new Error('Inventory item is not a recognized Magic Potion.');
  }

  try {
    await minecraftBot.equip(potion, 'hand');
  } catch (err) {
    throw new Error(
      `Could not equip Magic Potion: ${err.message}`
    );
  }

  /*
   * Mineflayer's consume() works for consumable items.
   * Some custom servers implement flight potions through
   * server-side interaction instead, so fall back to activating
   * the held item if consume() is unavailable.
   */
  try {
    if (typeof minecraftBot.consume === 'function') {
      await minecraftBot.consume();
    } else if (
      typeof minecraftBot.activateItem === 'function'
    ) {
      minecraftBot.activateItem();
    }
  } catch (err) {
    throw new Error(
      `Could not use Magic Potion: ${err.message}`
    );
  }

  return true;
}

function markAccepted(tradeId) {
  const trade = database.getTrade(tradeId);

  if (!trade) {
    throw new Error('Trade not found.');
  }

  if (!trade.verified) {
    throw new Error(
      'Trade must be verified before it can be accepted.'
    );
  }

  trade.accepted = true;
  trade.status = 'accepted';
  trade.updatedAt = new Date().toISOString();

  database.saveTrade(trade);

  return trade;
}

function markDenied(tradeId, reason = 'Trade denied') {
  const trade = database.getTrade(tradeId);

  if (!trade) {
    throw new Error('Trade not found.');
  }

  trade.accepted = false;
  trade.completed = false;
  trade.status = 'denied';
  trade.reason = reason;
  trade.updatedAt = new Date().toISOString();

  database.saveTrade(trade);

  return trade;
}

function markCompleted(bot, tradeId) {
  const trade = database.getTrade(tradeId);

  if (!trade) {
    throw new Error('Trade not found.');
  }

  const minecraftBot = bot.bot || bot;

  const verification = verifyExpectedItems(
    minecraftBot,
    trade.expectedItems
  );

  trade.verificationAfterTrade = verification;
  trade.completed = verification.valid;
  trade.status = verification.valid
    ? 'completed'
    : 'incomplete';

  trade.updatedAt = new Date().toISOString();

  database.saveTrade(trade);

  return trade;
}

async function waitForMagicPotion(
  bot,
  timeout = 120000
) {
  const minecraftBot = bot.bot || bot;

  const existing = findMagicPotion(minecraftBot);

  if (existing) {
    return existing;
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();

    const timer = setInterval(() => {
      const potion = findMagicPotion(minecraftBot);

      if (potion) {
        clearInterval(timer);
        resolve(potion);
        return;
      }

      if (Date.now() - started >= timeout) {
        clearInterval(timer);

        reject(
          new Error(
            'Timed out waiting for Magic Potion.'
          )
        );
      }
    }, 1000);
  });
}

function createMagicPotionTrade(botId, trader) {
  return createTrade({
    botId,
    trader,
    expectedItems: [
      {
        name: 'magic_potion',
        count: 1
      }
    ],
    purpose: 'flight'
  });
}

module.exports = {
  normalizeName,
  inventorySnapshot,
  findItem,
  countItem,
  findMagicPotion,

  createTrade,
  getTrade,
  listTrades,

  verifyExpectedItems,
  verifyTrade,

  verifyMagicPotion,
  consumeMagicPotion,
  waitForMagicPotion,

  createMagicPotionTrade,

  markAccepted,
  markDenied,
  markCompleted
};
