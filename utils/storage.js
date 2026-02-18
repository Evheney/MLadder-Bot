const fs = require("fs/promises");
const path = require("path");

function getGuildDataPath(guildId, fileName) {
  if (!guildId) throw new Error("This command must be used inside a server (not in DMs).");
  return path.join(__dirname, "..", "data", "guilds", guildId, fileName);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { getGuildDataPath, readJson, writeJson };
