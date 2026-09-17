const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');

const AIR_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'air'
]);

function normalizeBlockName(name) {
  if (!name) {
    return 'unknown';
  }

  let value = String(name).trim();

  /*
   * Legacy numeric IDs may appear in older
   * .schematic files. Keep them identifiable
   * instead of silently converting incorrectly.
   */
  if (/^\d+$/.test(value)) {
    return `legacy:${value}`;
  }

  if (!value.includes(':')) {
    value = `minecraft:${value}`;
  }

  return value.toLowerCase();
}


function isAir(name) {
  return AIR_BLOCKS.has(
    normalizeBlockName(name)
  );
}


function getNumber(value, fallback = 0) {
  if (typeof value === 'number') {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof value.value === 'number'
  ) {
    return value.value;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}


function unwrap(value) {
  if (
    value &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(
      value,
      'value'
    )
  ) {
    return value.value;
  }

  return value;
}


function getCompoundValue(compound, key) {
  if (!compound) {
    return undefined;
  }

  const value =
    compound[key];

  return unwrap(value);
}


/*
 * Converts an NBT value to a normal JavaScript
 * value where possible.
 */
function normalizeNbt(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      value,
      'value'
    )
  ) {
    return normalizeNbt(
      value.value
    );
  }

  if (Array.isArray(value)) {
    return value.map(
      normalizeNbt
    );
  }

  const result = {};

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    result[key] =
      normalizeNbt(child);
  }

  return result;
}


/*
 * Load an NBT file.
 */
async function loadNbt(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Schematic file not found: ${filePath}`
    );
  }

  const buffer =
    fs.readFileSync(filePath);

  const parsed =
    await nbt.parse(buffer);

  return normalizeNbt(
    parsed.parsed || parsed
  );
}


/* =========================================================
   Sponge .schem
========================================================= */

function parseSpongeSchematic(data) {
  const root =
    data.Schematic ||
    data;

  const width =
    getNumber(
      root.Width
    );

  const height =
    getNumber(
      root.Height
    );

  const length =
    getNumber(
      root.Length
    );

  if (
    width <= 0 ||
    height <= 0 ||
    length <= 0
  ) {
    throw new Error(
      'Invalid Sponge schematic dimensions'
    );
  }

  const palette =
    root.Palette ||
    root.BlockPalette ||
    {};

  const blockData =
    root.BlockData ||
    root.Blocks ||
    [];

  const paletteEntries =
    Object.entries(palette);

  const paletteById = {};

  for (
    const [name, id]
    of paletteEntries
  ) {
    paletteById[
      getNumber(id)
    ] =
      normalizeBlockName(name);
  }

  const blocks = [];

  let index = 0;

  /*
   * Sponge block data uses a varint stream.
   */
  const readVarInt = () => {
    let value = 0;
    let shift = 0;

    while (
      index < blockData.length
    ) {
      const current =
        Number(blockData[index++]);

      value |=
        (current & 0x7f) << shift;

      if (
        (current & 0x80) === 0
      ) {
        return value;
      }

      shift += 7;

      if (shift > 35) {
        throw new Error(
          'Invalid Sponge BlockData varint'
        );
      }
    }

    return 0;
  };


  const total =
    width *
    height *
    length;

  for (
    let i = 0;
    i < total;
    i++
  ) {
    const paletteId =
      readVarInt();

    const blockName =
      paletteById[paletteId] ||
      'minecraft:air';

    /*
     * Sponge order:
     * x changes fastest,
     * then z,
     * then y.
     */
    const x =
      i % width;

    const yz =
      Math.floor(i / width);

    const z =
      yz % length;

    const y =
      Math.floor(yz / length);

    if (!isAir(blockName)) {
      blocks.push({
        x,
        y,
        z,
        name: blockName,
        state: null
      });
    }
  }

  return {
    format: 'sponge',
    width,
    height,
    length,
    blocks
  };
}


/* =========================================================
   Legacy .schematic
========================================================= */

function parseLegacySchematic(data) {
  const root =
    data.Schematic ||
    data;

  const width =
    getNumber(
      root.Width
    );

  const height =
    getNumber(
      root.Height
    );

  const length =
    getNumber(
      root.Length
    );

  if (
    width <= 0 ||
    height <= 0 ||
    length <= 0
  ) {
    throw new Error(
      'Invalid legacy schematic dimensions'
    );
  }

  const blocks =
    root.Blocks || [];

  const blockData =
    root.Data || [];

  const palette =
    root.Palette || null;

  const result = [];

  const total =
    width *
    height *
    length;

  /*
   * Legacy schematic block IDs are numeric.
   *
   * The bot later resolves these IDs against
   * Minecraft 1.8.9 data.
   */
  for (
    let i = 0;
    i < total;
    i++
  ) {
    const id =
      Number(
        blocks[i] ?? 0
      );

    const metadata =
      Number(
        blockData[i] ?? 0
      );

    if (id === 0) {
      continue;
    }

    const x =
      i % width;

    const yz =
      Math.floor(i / width);

    const z =
      yz % length;

    const y =
      Math.floor(yz / length);

    let name;

    if (palette) {
      /*
       * Some converted legacy files contain
       * a palette mapping.
       */
      const paletteName =
        Object.keys(palette)
          .find(
            key =>
              Number(
                palette[key]
              ) === id
          );

      name =
        paletteName
          ? normalizeBlockName(
              paletteName
            )
          : `legacy:${id}`;
    } else {
      name =
        `legacy:${id}`;
    }

    result.push({
      x,
      y,
      z,
      id,
      metadata,
      name,
      state: metadata
    });
  }

  return {
    format: 'legacy',
    width,
    height,
    length,
    blocks: result
  };
}


/* =========================================================
   Format detection
========================================================= */

function detectFormat(data, filePath) {
  const root =
    data.Schematic ||
    data;

  if (
    root.Palette &&
    root.BlockData
  ) {
    return 'sponge';
  }

  if (
    root.Blocks &&
    (
      root.Data ||
      root.Width
    )
  ) {
    return 'legacy';
  }

  const extension =
    path.extname(filePath)
      .toLowerCase();

  if (extension === '.schem') {
    return 'sponge';
  }

  if (extension === '.schematic') {
    return 'legacy';
  }

  return 'unknown';
}


/* =========================================================
   Inspect
========================================================= */

async function inspect(filePath) {
  const data =
    await loadNbt(filePath);

  const format =
    detectFormat(
      data,
      filePath
    );

  let parsed;

  if (format === 'sponge') {
    parsed =
      parseSpongeSchematic(data);
  } else if (format === 'legacy') {
    parsed =
      parseLegacySchematic(data);
  } else {
    throw new Error(
      'Unsupported schematic format'
    );
  }

  const materials = {};

  for (
    const block
    of parsed.blocks
  ) {
    const name =
      normalizeBlockName(
        block.name
      );

    materials[name] =
      (materials[name] || 0) + 1;
  }

  return {
    format: parsed.format,

    width: parsed.width,
    height: parsed.height,
    length: parsed.length,

    totalBlocks:
      parsed.blocks.length,

    materials,

    /*
     * Do not store the entire block array
     * inside state.json during inspection.
     */
    inspectedAt: Date.now()
  };
}


/* =========================================================
   Load complete schematic
========================================================= */

async function load(filePath) {
  const data =
    await loadNbt(filePath);

  const format =
    detectFormat(
      data,
      filePath
    );

  if (format === 'sponge') {
    return parseSpongeSchematic(data);
  }

  if (format === 'legacy') {
    return parseLegacySchematic(data);
  }

  throw new Error(
    'Unsupported schematic format'
  );
}


/* =========================================================
   Material summary
========================================================= */

async function materials(filePath) {
  const schematic =
    await load(filePath);

  const result = {};

  for (
    const block
    of schematic.blocks
  ) {
    const name =
      normalizeBlockName(
        block.name
      );

    result[name] =
      (result[name] || 0) + 1;
  }

  return result;
}


/* =========================================================
   Block count
========================================================= */

async function count(filePath) {
  const schematic =
    await load(filePath);

  return schematic.blocks.length;
}


module.exports = {
  loadNbt,
  normalizeNbt,

  inspect,
  load,
  materials,
  count,

  normalizeBlockName,
  isAir
};
