const { getGuildDataPath, readJson, writeJson } = require("./storage");

async function getAll(guildId) {
  const file = getGuildDataPath(guildId, "valor.json");
  return readJson(file);
}

async function upsert(guildId, userId, valor, type) {
  const file = getGuildDataPath(guildId, "valor.json");
  const db = await readJson(file);

  db[userId] = {
    valor,
    type,
    updatedAt: Date.now()
  };

  await writeJson(file, db);
  return db[userId];
}

async function getUser(guildId, userId) {
  const file = getGuildDataPath(guildId, "valor.json");
  const db = await readJson(file);
  return db[userId] || null;
}

module.exports = { getAll, upsert, getUser };
