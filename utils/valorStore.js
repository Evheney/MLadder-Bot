const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

let seasonManager = null;
try {
  seasonManager = require("./seasonManager");
} catch {}

/**
 * Storage location:
 * - If season system exists and a season is active -> data/seasons/<season>/valor.json
 * - Else -> data/valor.json
 */
function getValorPath() {
  if (seasonManager) {
    const current = seasonManager.getCurrentSeason?.();
    if (current) {
      return seasonManager.getSeasonPath("valor.json");
    }
  }
  return path.join(__dirname, "..", "data", "valor.json");
}

async function readJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Shape:
// {
//   "<userId>": { "valor": 5000000000, "type": "player"|"builder", "updatedAt": 1234567890 }
// }
async function getAll() {
  return readJson(getValorPath());
}

async function upsert(userId, valor, type) {
  const db = await getAll();
  db[userId] = { valor, type, updatedAt: Date.now() };
  await writeJson(getValorPath(), db);
  return db[userId];
}

async function getUser(userId) {
  const db = await getAll();
  return db[userId] || null;
}

module.exports = { getAll, upsert, getUser };
