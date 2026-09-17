const fs = require("fs");
const path = require("path");

const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, "data");

const SCHEMATICS_DIR =
  process.env.SCHEMATICS_DIR ||
  path.join(DATA_DIR, "schematics");

const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(DATA_DIR, "state.json");

const DEFAULT_STATE = {
  bots: {},
  schematics: {},
  builds: {},
  trades: {},
  coop: {},
  settings: {
    targetUsername:
      process.env.TARGET_USERNAME || "V_Mallu_Gamer"
  }
};

/* --------------------------------------------------
   STORAGE
-------------------------------------------------- */

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });

  fs.mkdirSync(SCHEMATICS_DIR, {
    recursive: true
  });

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(DEFAULT_STATE, null, 2),
      "utf8"
    );
  }
}

function cloneDefaultState() {
  return JSON.parse(
    JSON.stringify(DEFAULT_STATE)
  );
}

function readState() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(
      STATE_FILE,
      "utf8"
    );

    if (!raw.trim()) {
      const state = cloneDefaultState();

      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(state, null, 2),
        "utf8"
      );

      return state;
    }

    const parsed = JSON.parse(raw);

    return {
      ...cloneDefaultState(),
      ...parsed,

      bots: parsed.bots || {},
      schematics: parsed.schematics || {},
      builds: parsed.builds || {},
      trades: parsed.trades || {},
      coop: parsed.coop || {},

      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed.settings || {})
      }
    };
  } catch (error) {
    console.error(
      "[DATABASE] Failed to read state:",
      error.message
    );

    const state = cloneDefaultState();

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2),
      "utf8"
    );

    return state;
  }
}

function writeState(state) {
  /*
   * IMPORTANT:
   * Do NOT call ensureStorage() here.
   * ensureStorage() must never call writeState().
   */

  if (!state || typeof state !== "object") {
    throw new TypeError(
      "writeState() requires a state object"
    );
  }

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  return state;
}

function updateState(updater) {
  const state = readState();

  const updated =
    typeof updater === "function"
      ? updater(state)
      : {
          ...state,
          ...updater
        };

  writeState(updated);

  return updated;
}

function getState() {
  return readState();
}

function replaceState(state) {
  return writeState(state);
}

/* --------------------------------------------------
   GENERIC HELPERS
-------------------------------------------------- */

function makeId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function upsert(collection, item, prefix) {
  const state = readState();

  const id =
    item.id ||
    makeId(prefix);

  state[collection][id] = {
    ...(state[collection][id] || {}),
    ...item,
    id,
    updatedAt: new Date().toISOString()
  };

  if (!state[collection][id].createdAt) {
    state[collection][id].createdAt =
      new Date().toISOString();
  }

  writeState(state);

  return state[collection][id];
}

function remove(collection, id) {
  const state = readState();

  if (state[collection]?.[id]) {
    delete state[collection][id];
    writeState(state);
    return true;
  }

  return false;
}

function get(collection, id) {
  const state = readState();

  return state[collection]?.[id] || null;
}

function list(collection) {
  const state = readState();

  return Object.values(
    state[collection] || {}
  );
}

/* --------------------------------------------------
   BOTS
-------------------------------------------------- */

function getBots() {
  return list("bots");
}

function getBot(id) {
  return get("bots", id);
}

function saveBot(bot) {
  return upsert(
    "bots",
    bot,
    "bot"
  );
}

function deleteBot(id) {
  return remove(
    "bots",
    id
  );
}

/* --------------------------------------------------
   SCHEMATICS
-------------------------------------------------- */

function getSchematics() {
  return list("schematics");
}

function getSchematic(id) {
  return get(
    "schematics",
    id
  );
}

function saveSchematic(schematic) {
  return upsert(
    "schematics",
    schematic,
    "schematic"
  );
}

function deleteSchematic(id) {
  return remove(
    "schematics",
    id
  );
}

/* --------------------------------------------------
   BUILDS
-------------------------------------------------- */

function getBuilds() {
  return list("builds");
}

function getBuild(id) {
  return get(
    "builds",
    id
  );
}

function saveBuild(build) {
  return upsert(
    "builds",
    build,
    "build"
  );
}

function deleteBuild(id) {
  return remove(
    "builds",
    id
  );
}

/* --------------------------------------------------
   TRADES
-------------------------------------------------- */

function getTrades() {
  return list("trades");
}

function getTrade(id) {
  return get(
    "trades",
    id
  );
}

function saveTrade(trade) {
  return upsert(
    "trades",
    trade,
    "trade"
  );
}

function deleteTrade(id) {
  return remove(
    "trades",
    id
  );
}

/* --------------------------------------------------
   CO-OP
-------------------------------------------------- */

function getCoops() {
  return list("coop");
}

function getCoop(id) {
  return get(
    "coop",
    id
  );
}

function saveCoop(coop) {
  return upsert(
    "coop",
    coop,
    "coop"
  );
}

function deleteCoop(id) {
  return remove(
    "coop",
    id
  );
}

/* --------------------------------------------------
   SETTINGS
-------------------------------------------------- */

function getSettings() {
  const state = readState();

  return {
    ...DEFAULT_STATE.settings,
    ...(state.settings || {})
  };
}

function saveSettings(settings) {
  const state = readState();

  state.settings = {
    ...(state.settings || {}),
    ...(settings || {})
  };

  writeState(state);

  return state.settings;
}

/* --------------------------------------------------
   INITIALIZE
-------------------------------------------------- */

ensureStorage();

/* --------------------------------------------------
   EXPORTS
-------------------------------------------------- */

module.exports = {
  DATA_DIR,
  STATE_FILE,
  SCHEMATICS_DIR,

  DEFAULT_STATE,

  ensureStorage,
  readState,
  writeState,
  updateState,
  getState,
  replaceState,

  getBots,
  getBot,
  saveBot,
  deleteBot,

  getSchematics,
  getSchematic,
  saveSchematic,
  deleteSchematic,

  getBuilds,
  getBuild,
  saveBuild,
  deleteBuild,

  getTrades,
  getTrade,
  saveTrade,
  deleteTrade,

  getCoops,
  getCoop,
  saveCoop,
  deleteCoop,

  getSettings,
  saveSettings
};
