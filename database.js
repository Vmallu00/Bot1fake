const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SCHEMATICS_DIR =
  process.env.SCHEMATICS_DIR || path.join(DATA_DIR, 'schematics');

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SCHEMATICS_DIR, { recursive: true });

  if (!fs.existsSync(STATE_FILE)) {
    writeState({
      bots: {},
      schematics: {},
      builds: {},
      trades: {},
      coop: {},
      settings: {
        targetUsername:
          process.env.TARGET_USERNAME || 'V_Mallu_Gamer'
      }
    });
  }
}

function defaultState() {
  return {
    bots: {},
    schematics: {},
    builds: {},
    trades: {},
    coop: {},
    settings: {
      targetUsername:
        process.env.TARGET_USERNAME || 'V_Mallu_Gamer'
    }
  };
}

function readState() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');

    if (!raw.trim()) {
      return defaultState();
    }

    const parsed = JSON.parse(raw);

    return {
      ...defaultState(),
      ...parsed,
      bots: parsed.bots || {},
      schematics: parsed.schematics || {},
      builds: parsed.builds || {},
      trades: parsed.trades || {},
      coop: parsed.coop || {},
      settings: {
        ...defaultState().settings,
        ...(parsed.settings || {})
      }
    };
  } catch (error) {
    console.error('[DATABASE] Failed to read state:', error.message);
    return defaultState();
  }
}

function writeState(state) {
  ensureStorage();

  const tempFile = `${STATE_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(state, null, 2),
    'utf8'
  );

  fs.renameSync(tempFile, STATE_FILE);
}

function updateState(callback) {
  const state = readState();

  callback(state);

  writeState(state);

  return state;
}


/* =========================
   Bots
========================= */

function getBots() {
  return readState().bots;
}

function getBot(id) {
  return readState().bots[id] || null;
}

function saveBot(id, data) {
  updateState(state => {
    state.bots[id] = {
      ...(state.bots[id] || {}),
      ...data,
      updatedAt: Date.now()
    };
  });
}

function deleteBot(id) {
  updateState(state => {
    delete state.bots[id];
  });
}


/* =========================
   Schematics
========================= */

function getSchematics() {
  return readState().schematics;
}

function getSchematic(id) {
  return readState().schematics[id] || null;
}

function saveSchematic(id, data) {
  updateState(state => {
    state.schematics[id] = {
      ...(state.schematics[id] || {}),
      ...data,
      updatedAt: Date.now()
    };
  });
}

function deleteSchematic(id) {
  updateState(state => {
    delete state.schematics[id];
  });
}


/* =========================
   Builds
========================= */

function getBuilds() {
  return readState().builds;
}

function getBuild(id) {
  return readState().builds[id] || null;
}

function saveBuild(id, data) {
  updateState(state => {
    state.builds[id] = {
      ...(state.builds[id] || {}),
      ...data,
      updatedAt: Date.now()
    };
  });
}

function deleteBuild(id) {
  updateState(state => {
    delete state.builds[id];
  });
}


/* =========================
   Trades
========================= */

function getTrades() {
  return readState().trades;
}

function getTrade(id) {
  return readState().trades[id] || null;
}

function saveTrade(id, data) {
  updateState(state => {
    state.trades[id] = {
      ...(state.trades[id] || {}),
      ...data,
      updatedAt: Date.now()
    };
  });
}

function deleteTrade(id) {
  updateState(state => {
    delete state.trades[id];
  });
}


/* =========================
   Co-op
========================= */

function getCoop() {
  return readState().coop;
}

function getCoopRequest(id) {
  return readState().coop[id] || null;
}

function saveCoopRequest(id, data) {
  updateState(state => {
    state.coop[id] = {
      ...(state.coop[id] || {}),
      ...data,
      updatedAt: Date.now()
    };
  });
}

function deleteCoopRequest(id) {
  updateState(state => {
    delete state.coop[id];
  });
}


/* =========================
   Settings
========================= */

function getSettings() {
  return readState().settings;
}

function saveSettings(data) {
  updateState(state => {
    state.settings = {
      ...state.settings,
      ...data
    };
  });
}


/* =========================
   Full state
========================= */

function getState() {
  return readState();
}

function replaceState(state) {
  writeState(state);
}


/* =========================
   Initialize
========================= */

ensureStorage();


module.exports = {
  DATA_DIR,
  STATE_FILE,
  SCHEMATICS_DIR,

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

  getCoop,
  getCoopRequest,
  saveCoopRequest,
  deleteCoopRequest,

  getSettings,
  saveSettings
};
