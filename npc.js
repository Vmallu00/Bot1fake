'use strict';

const database = require('./database');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function distance(a, b) {
  if (!a || !b) return Infinity;

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;

  return Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );
}

function findNearbyEntities(bot, name, maxDistance = 8) {
  if (!bot || !bot.entities) {
    return [];
  }

  const wanted = normalizeName(name);
  const origin = bot.entity?.position;

  if (!origin) {
    return [];
  }

  return Object.values(bot.entities)
    .filter(entity => {
      if (!entity || !entity.position) {
        return false;
      }

      const entityName =
        normalizeName(
          entity.username ||
          entity.displayName ||
          entity.name
        );

      if (
        wanted &&
        !entityName.includes(wanted)
      ) {
        return false;
      }

      return distance(
        origin,
        entity.position
      ) <= maxDistance;
    })
    .sort(
      (a, b) =>
        distance(origin, a.position) -
        distance(origin, b.position)
    );
}

async function lookAt(bot, position) {
  if (!bot || !position) {
    return;
  }

  if (
    typeof bot.lookAt === 'function'
  ) {
    await bot.lookAt(
      position,
      true
    );
  }
}

async function moveNear(bot, position) {
  if (!bot || !position) {
    throw new Error(
      'NPC position is unavailable.'
    );
  }

  if (
    !bot.pathfinder ||
    !bot.mcData
  ) {
    return;
  }

  /*
   * NPC movement is intentionally handled by
   * the main bot pathfinder. This module only
   * requests a nearby position.
   */
  const Movements =
    require('mineflayer-pathfinder')
      .Movements;

  const goals =
    require('mineflayer-pathfinder')
      .goals;

  const movements =
    new Movements(
      bot,
      bot.mcData
    );

  bot.pathfinder.setMovements(
    movements
  );

  bot.pathfinder.setGoal(
    new goals.GoalNear(
      position.x,
      position.y,
      position.z,
      2
    )
  );

  await new Promise(resolve => {
    const timeout =
      setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 15000);

    const check = setInterval(() => {
      if (!bot.entity?.position) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
        return;
      }

      if (
        distance(
          bot.entity.position,
          position
        ) <= 3
      ) {
        clearInterval(check);
        clearTimeout(timeout);

        bot.pathfinder.setGoal(null);

        resolve();
      }
    }, 250);
  });
}

async function clickEntity(
  bot,
  entity,
  button = 'right',
  times = 1
) {
  if (!entity) {
    throw new Error(
      'NPC/entity was not found.'
    );
  }

  if (
    !bot.entity?.position ||
    !entity.position
  ) {
    throw new Error(
      'NPC position is unavailable.'
    );
  }

  await moveNear(
    bot,
    entity.position
  );

  await lookAt(
    bot,
    entity.position
  );

  for (
    let i = 0;
    i < Math.max(1, times);
    i++
  ) {
    /*
     * Mineflayer exposes activateEntity
     * for right-click interaction.
     *
     * Left-click is attackEntity and is
     * only used when explicitly requested.
     */
    if (
      button === 'left' ||
      button === 'attack'
    ) {
      bot.attack(entity);
    } else {
      await bot.activateEntity(
        entity
      );
    }

    await new Promise(
      resolve =>
        setTimeout(resolve, 350)
    );
  }
}

async function clickNPC(
  bot,
  name,
  options = {}
) {
  if (!bot) {
    throw new Error(
      'Minecraft bot is not available.'
    );
  }

  const {
    button = 'right',
    maxDistance = 8,
    times = 1
  } = options;

  const entities =
    findNearbyEntities(
      bot,
      name,
      maxDistance
    );

  if (!entities.length) {
    throw new Error(
      `NPC "${name}" was not found nearby.`
    );
  }

  const entity = entities[0];

  await clickEntity(
    bot,
    entity,
    button,
    times
  );

  return {
    name,
    entityId: entity.id,
    distance: distance(
      bot.entity.position,
      entity.position
    )
  };
}

async function rightClick(
  bot,
  name,
  options = {}
) {
  return clickNPC(
    bot,
    name,
    {
      ...options,
      button: 'right'
    }
  );
}

async function leftClick(
  bot,
  name,
  options = {}
) {
  return clickNPC(
    bot,
    name,
    {
      ...options,
      button: 'left'
    }
  );
}

function listNPCs(
  bot,
  maxDistance = 32
) {
  if (!bot?.entities) {
    return [];
  }

  const origin =
    bot.entity?.position;

  if (!origin) {
    return [];
  }

  return Object.values(bot.entities)
    .filter(entity => {
      if (!entity?.position) {
        return false;
      }

      return distance(
        origin,
        entity.position
      ) <= maxDistance;
    })
    .map(entity => ({
      id: entity.id,
      username:
        entity.username || null,
      name:
        entity.displayName ||
        entity.name ||
        null,
      type:
        entity.type || null,
      position: {
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z
      },
      distance: distance(
        origin,
        entity.position
      )
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance
    );
}

function rememberNPC(
  botId,
  name,
  data = {}
) {
  const state =
    database.getState();

  state.npcs =
    state.npcs || {};

  state.npcs[
    normalizeName(name)
  ] = {
    botId,
    name,
    ...data,
    updatedAt:
      new Date().toISOString()
  };

  database.replaceState(state);

  return state.npcs[
    normalizeName(name)
  ];
}

function getRememberedNPC(name) {
  const state =
    database.getState();

  return state.npcs?.[
    normalizeName(name)
  ] || null;
}

module.exports = {
  normalizeName,
  distance,

  findNearbyEntities,
  listNPCs,

  moveNear,
  lookAt,

  clickEntity,
  clickNPC,

  rightClick,
  leftClick,

  rememberNPC,
  getRememberedNPC
};
