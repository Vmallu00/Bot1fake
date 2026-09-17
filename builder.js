'use strict';

const fs = require('fs');
const path = require('path');
const minecraftData = require('minecraft-data');
const database = require('./database');
const schematic = require('./schematic');

const mcData = minecraftData('1.8.9');

const BUILD_DELAY_MS = Number(process.env.BUILD_DELAY_MS || 180);
const MAX_Y = 255;
const MIN_Y = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function position(x, y, z) {
  return { x, y, z };
}

function normalizeName(name) {
  if (!name) return '';

  let value = String(name)
    .toLowerCase()
    .trim()
    .replace(/^minecraft:/, '');

  // Remove Sponge block-state information.
  const stateIndex = value.indexOf('[');
  if (stateIndex !== -1) {
    value = value.slice(0, stateIndex);
  }

  return value;
}

function resolveLegacyBlock(id) {
  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  const block = mcData.blocks[numericId];

  if (!block) {
    return null;
  }

  return block.name;
}

function resolveBlockName(block) {
  if (!block) return null;

  if (block.name && !block.name.startsWith('legacy:')) {
    return normalizeName(block.name);
  }

  if (block.id !== undefined) {
    return resolveLegacyBlock(block.id);
  }

  if (typeof block.name === 'string' && block.name.startsWith('legacy:')) {
    return resolveLegacyBlock(block.name.split(':')[1]);
  }

  return null;
}

function isAirName(name) {
  const normalized = normalizeName(name);

  return (
    normalized === '' ||
    normalized === 'air' ||
    normalized === 'cave_air' ||
    normalized === 'void_air'
  );
}

function isSameBlock(worldBlock, wantedName) {
  if (!worldBlock) return false;

  const actual = normalizeName(worldBlock.name);
  const wanted = normalizeName(wantedName);

  if (actual === wanted) return true;

  // Some old Mineflayer block names can differ slightly from
  // schematic names.
  if (wanted === 'grass' && actual === 'grass_block') return true;
  if (wanted === 'grass_block' && actual === 'grass') return true;

  return false;
}

function getVec3(bot, x, y, z) {
  if (
    bot &&
    bot.entity &&
    bot.entity.position &&
    bot.entity.position.constructor
  ) {
    const Vec3 = bot.entity.position.constructor;
    return new Vec3(x, y, z);
  }

  return { x, y, z };
}

function getFaceVector(bot, dx, dy, dz) {
  return getVec3(bot, dx, dy, dz);
}

function getInventoryCount(bot, blockName) {
  const wanted = normalizeName(blockName);

  let total = 0;

  for (const item of bot.inventory.items()) {
    if (normalizeName(item.name) === wanted) {
      total += item.count || 0;
    }
  }

  return total;
}

async function equipBlock(bot, blockName) {
  const wanted = normalizeName(blockName);

  const item = bot.inventory
    .items()
    .find(item => normalizeName(item.name) === wanted);

  if (!item) {
    return false;
  }

  try {
    await bot.equip(item, 'hand');
    return true;
  } catch (err) {
    return false;
  }
}

function getBuildOrigin(build) {
  return {
    x: Number(build.x),
    y: Number(build.y),
    z: Number(build.z)
  };
}

function validateOrigin(origin) {
  if (
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y) ||
    !Number.isFinite(origin.z)
  ) {
    throw new Error('Invalid build coordinates.');
  }

  if (origin.y < MIN_Y || origin.y > MAX_Y) {
    throw new Error('Build Y coordinate must be between 0 and 255.');
  }
}

function getReferenceDirections() {
  return [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
  ];
}

function findReferenceBlock(bot, target, targetSet, placedSet) {
  for (const direction of getReferenceDirections()) {
    const rx = target.x + direction.x;
    const ry = target.y + direction.y;
    const rz = target.z + direction.z;

    const referenceKey = key(rx, ry, rz);

    // Prefer already-built schematic blocks.
    if (targetSet.has(referenceKey) && !placedSet.has(referenceKey)) {
      continue;
    }

    const block = bot.blockAt(getVec3(bot, rx, ry, rz));

    if (!block) continue;

    if (!isAirName(block.name)) {
      return {
        block,
        face: getFaceVector(
          bot,
          -direction.x,
          -direction.y,
          -direction.z
        )
      };
    }
  }

  return null;
}

function sortBlocks(blocks) {
  /*
   * Build lower blocks first.
   * This helps naturally create support for structures
   * that are connected to the ground.
   */
  return blocks.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });
}

async function inspectWorld(bot, blocks, placedSet) {
  let alreadyPlaced = 0;

  for (const block of blocks) {
    const world = bot.blockAt(
      getVec3(bot, block.x, block.y, block.z)
    );

    if (isSameBlock(world, block.name)) {
      placedSet.add(key(block.x, block.y, block.z));
      alreadyPlaced++;
    }
  }

  return alreadyPlaced;
}

function calculateMissingMaterials(bot, blocks, placedSet) {
  const required = {};
  const available = {};
  const missing = {};

  for (const block of blocks) {
    const blockKey = key(block.x, block.y, block.z);

    if (placedSet.has(blockKey)) {
      continue;
    }

    const name = normalizeName(block.name);

    if (isAirName(name)) {
      continue;
    }

    required[name] = (required[name] || 0) + 1;
  }

  for (const name of Object.keys(required)) {
    available[name] = getInventoryCount(bot, name);

    if (available[name] < required[name]) {
      missing[name] = required[name] - available[name];
    }
  }

  return {
    required,
    available,
    missing
  };
}

function missingTotal(missing) {
  return Object.values(missing)
    .reduce((sum, value) => sum + Number(value || 0), 0);
}

function buildProgress(total, placed) {
  const percent = total > 0
    ? Math.floor((placed / total) * 100)
    : 100;

  return {
    placed,
    total,
    percent: Math.min(100, Math.max(0, percent))
  };
}

async function saveProgress(build, patch) {
  const updated = {
    ...build,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  database.saveBuild(updated);

  return updated;
}

async function start(bot, build) {
  if (!bot) {
    throw new Error('Bot instance is not available.');
  }

  if (!build) {
    throw new Error('Build information is missing.');
  }

  if (!bot.bot || !bot.bot.entity) {
    throw new Error('Minecraft bot is not connected.');
  }

  if (!bot.spawned) {
    throw new Error('Minecraft bot has not spawned yet.');
  }

  if (!bot.cooped) {
    throw new Error('Bot is not in the required co-op/island yet.');
  }

  if (!bot.flight) {
    throw new Error('Flight is not enabled. Complete the Magic Potion step first.');
  }

  const schematicRecord = database.getSchematic(build.schematicId);

  if (!schematicRecord) {
    throw new Error('Schematic was not found.');
  }

  if (!schematicRecord.path || !fs.existsSync(schematicRecord.path)) {
    throw new Error('Schematic file does not exist.');
  }

  const origin = getBuildOrigin(build);
  validateOrigin(origin);

  const loaded = await schematic.load(schematicRecord.path);

  let blocks = Array.isArray(loaded.blocks)
    ? loaded.blocks
    : [];

  blocks = blocks
    .map(block => {
      const name = resolveBlockName(block);

      if (!name || isAirName(name)) {
        return null;
      }

      return {
        x: origin.x + Number(block.x),
        y: origin.y + Number(block.y),
        z: origin.z + Number(block.z),
        name,
        id: block.id,
        metadata: block.metadata
      };
    })
    .filter(Boolean);

  if (!blocks.length) {
    throw new Error('Schematic contains no placeable blocks.');
  }

  for (const block of blocks) {
    if (
      block.y < MIN_Y ||
      block.y > MAX_Y
    ) {
      throw new Error(
        `Block ${block.name} is outside Minecraft 1.8.9 height limits at Y=${block.y}.`
      );
    }
  }

  sortBlocks(blocks);

  const targetSet = new Set(
    blocks.map(block => key(block.x, block.y, block.z))
  );

  const placedSet = new Set();

  await saveProgress(build, {
    status: 'checking',
    currentBlock: null,
    totalBlocks: blocks.length,
    placedBlocks: 0,
    progress: 0,
    error: null
  });

  const alreadyPlaced = await inspectWorld(
    bot.bot,
    blocks,
    placedSet
  );

  await saveProgress(build, {
    status: 'checking-materials',
    placedBlocks: alreadyPlaced,
    totalBlocks: blocks.length,
    progress: buildProgress(
      blocks.length,
      alreadyPlaced
    ).percent
  });

  let materials = calculateMissingMaterials(
    bot.bot,
    blocks,
    placedSet
  );

  if (missingTotal(materials.missing) > 0) {
    await saveProgress(build, {
      status: 'waiting-materials',
      placedBlocks: alreadyPlaced,
      totalBlocks: blocks.length,
      progress: buildProgress(
        blocks.length,
        alreadyPlaced
      ).percent,
      requiredMaterials: materials.required,
      availableMaterials: materials.available,
      missingMaterials: materials.missing,
      error: null
    });

    bot.log?.(
      `Build paused: missing ${missingTotal(materials.missing)} blocks.`
    );

    return {
      status: 'waiting-materials',
      missing: materials.missing
    };
  }

  await saveProgress(build, {
    status: 'building',
    error: null,
    requiredMaterials: materials.required,
    availableMaterials: materials.available,
    missingMaterials: {}
  });

  let placedCount = placedSet.size;
  let lastProgress = placedCount;

  /*
   * Repeated passes are important.
   *
   * A block may initially have no legal reference face,
   * but become placeable after another nearby block is placed.
   */
  let remaining = blocks.filter(
    block => !placedSet.has(key(block.x, block.y, block.z))
  );

  let safetyPasses = 0;

  while (remaining.length > 0) {
    safetyPasses++;

    if (safetyPasses > blocks.length * 2 + 20) {
      throw new Error(
        'Build stopped because no further safe placement progress was possible.'
      );
    }

    let progressThisPass = false;
    const blocked = [];

    for (const block of remaining) {
      if (!bot.bot || !bot.spawned) {
        throw new Error('Bot disconnected during build.');
      }

      if (bot.buildPaused) {
        await saveProgress(build, {
          status: 'paused',
          placedBlocks: placedCount,
          totalBlocks: blocks.length,
          progress: buildProgress(
            blocks.length,
            placedCount
          ).percent,
          currentBlock: {
            x: block.x,
            y: block.y,
            z: block.z,
            name: block.name
          }
        });

        return {
          status: 'paused',
          placed: placedCount
        };
      }

      const blockKey = key(
        block.x,
        block.y,
        block.z
      );

      const worldBlock = bot.bot.blockAt(
        getVec3(
          bot.bot,
          block.x,
          block.y,
          block.z
        )
      );

      if (isSameBlock(worldBlock, block.name)) {
        placedSet.add(blockKey);
        placedCount++;
        progressThisPass = true;
        continue;
      }

      /*
       * If another block exists here, do not destroy it.
       * This protects existing island structures.
       */
      if (
        worldBlock &&
        !isAirName(worldBlock.name) &&
        !isSameBlock(worldBlock, block.name)
      ) {
        await saveProgress(build, {
          status: 'paused',
          placedBlocks: placedCount,
          totalBlocks: blocks.length,
          progress: buildProgress(
            blocks.length,
            placedCount
          ).percent,
          currentBlock: {
            x: block.x,
            y: block.y,
            z: block.z,
            name: block.name
          },
          error:
            `Existing block mismatch at ${block.x},${block.y},${block.z}: ` +
            `${worldBlock.name} instead of ${block.name}.`
        });

        return {
          status: 'blocked',
          placed: placedCount
        };
      }

      const reference = findReferenceBlock(
        bot.bot,
        block,
        targetSet,
        placedSet
      );

      if (!reference) {
        blocked.push(block);
        continue;
      }

      const equipped = await equipBlock(
        bot.bot,
        block.name
      );

      if (!equipped) {
        materials = calculateMissingMaterials(
          bot.bot,
          blocks,
          placedSet
        );

        await saveProgress(build, {
          status: 'waiting-materials',
          placedBlocks: placedCount,
          totalBlocks: blocks.length,
          progress: buildProgress(
            blocks.length,
            placedCount
          ).percent,
          requiredMaterials: materials.required,
          availableMaterials: materials.available,
          missingMaterials: materials.missing,
          error: `Missing inventory item: ${block.name}`
        });

        return {
          status: 'waiting-materials',
          missing: materials.missing
        };
      }

      await saveProgress(build, {
        status: 'building',
        currentBlock: {
          x: block.x,
          y: block.y,
          z: block.z,
          name: block.name
        },
        placedBlocks: placedCount,
        totalBlocks: blocks.length,
        progress: buildProgress(
          blocks.length,
          placedCount
        ).percent
      });

      try {
        await bot.bot.placeBlock(
          reference.block,
          reference.face
        );
      } catch (err) {
        blocked.push(block);

        bot.log?.(
          `Placement failed at ${block.x},${block.y},${block.z}: ${err.message}`
        );

        continue;
      }

      await sleep(BUILD_DELAY_MS);

      const after = bot.bot.blockAt(
        getVec3(
          bot.bot,
          block.x,
          block.y,
          block.z
        )
      );

      if (!isSameBlock(after, block.name)) {
        blocked.push(block);
        continue;
      }

      placedSet.add(blockKey);
      placedCount++;
      progressThisPass = true;

      if (
        placedCount !== lastProgress &&
        (placedCount % 5 === 0 || placedCount === blocks.length)
      ) {
        lastProgress = placedCount;

        await saveProgress(build, {
          status: 'building',
          placedBlocks: placedCount,
          totalBlocks: blocks.length,
          progress: buildProgress(
            blocks.length,
            placedCount
          ).percent,
          currentBlock: {
            x: block.x,
            y: block.y,
            z: block.z,
            name: block.name
          },
          error: null
        });
      }
    }

    remaining = blocks.filter(
      block => !placedSet.has(
        key(block.x, block.y, block.z)
      )
    );

    /*
     * If a complete pass cannot place anything,
     * the schematic contains blocks that have no valid
     * reference face from the current world.
     */
    if (!progressThisPass) {
      const firstBlocked = blocked[0] || remaining[0];

      await saveProgress(build, {
        status: 'blocked',
        placedBlocks: placedCount,
        totalBlocks: blocks.length,
        progress: buildProgress(
          blocks.length,
          placedCount
        ).percent,
        currentBlock: firstBlocked
          ? {
              x: firstBlocked.x,
              y: firstBlocked.y,
              z: firstBlocked.z,
              name: firstBlocked.name
            }
          : null,
        error:
          'No valid reference block was found. ' +
          'This part of the schematic may be floating. ' +
          'Provide a connected support/reference block and resume.'
      });

      bot.log?.(
        'Build paused: no valid reference block for the remaining blocks.'
      );

      return {
        status: 'blocked',
        placed: placedCount,
        remaining: remaining.length
      };
    }
  }

  await saveProgress(build, {
    status: 'completed',
    placedBlocks: blocks.length,
    totalBlocks: blocks.length,
    progress: 100,
    currentBlock: null,
    missingMaterials: {},
    error: null,
    completedAt: new Date().toISOString()
  });

  bot.log?.(
    `Build completed: ${build.name || build.id}`
  );

  return {
    status: 'completed',
    placed: blocks.length,
    total: blocks.length
  };
}

async function resume(bot, build) {
  if (!build) {
    throw new Error('Build not found.');
  }

  return start(bot, build);
}

function getRequiredMaterials(bot, build) {
  if (!bot || !build) {
    return null;
  }

  const schematicRecord = database.getSchematic(
    build.schematicId
  );

  if (!schematicRecord || !fs.existsSync(schematicRecord.path)) {
    return null;
  }

  return schematic.load(schematicRecord.path)
    .then(loaded => {
      const origin = getBuildOrigin(build);

      const blocks = loaded.blocks
        .map(block => {
          const name = resolveBlockName(block);

          if (!name || isAirName(name)) {
            return null;
          }

          return {
            x: origin.x + Number(block.x),
            y: origin.y + Number(block.y),
            z: origin.z + Number(block.z),
            name
          };
        })
        .filter(Boolean);

      const placedSet = new Set();

      return calculateMissingMaterials(
        bot.bot,
        blocks,
        placedSet
      );
    });
}

module.exports = {
  start,
  resume,
  getRequiredMaterials,
  resolveBlockName,
  normalizeName,
  getInventoryCount
};
