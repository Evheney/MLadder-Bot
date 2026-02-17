const fs = require("fs/promises");
const path = require("path");

const REQUESTS_PATH = path.join(__dirname, "..", "data", "requests.json");
const HITS_PATH = path.join(__dirname, "..", "data", "hits.json");
const MAX_HITS_PER_USER = 50;

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

module.exports = function registerReactionAddHandler(client) {
  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
      if (reaction.emoji.name !== "✅") return;

      const messageId = reaction.message.id;

      const requests = await readJson(REQUESTS_PATH);
      const req = requests[messageId];
      if (!req) return;

      const levels = Array.isArray(req.levels)
        ? req.levels
        : (req.level ? [req.level] : []);

      if (levels.length === 0) return;

      const hits = await readJson(HITS_PATH);
      const arr = Array.isArray(hits[req.userId]) ? hits[req.userId] : [];

      // record in order
      for (const lvl of levels) arr.push(lvl);

      hits[req.userId] = arr.length > MAX_HITS_PER_USER ? arr.slice(-MAX_HITS_PER_USER) : arr;
      await writeJson(HITS_PATH, hits);

      delete requests[messageId];
      await writeJson(REQUESTS_PATH, requests);

      // DM the player (ignore failures)
    //  try {
    //    const target = await client.users.fetch(req.userId);
    //    await target.send(`✅ Built city recorded: level **${req.level}**`);
    //  } catch {}

      // Optional: react with 🧾 or edit message to show "Completed"
      // (don’t do it yet unless you want)
      // Optional: mark complete
      try { await reaction.message.react("🟩"); } catch {}
    } catch (e) {
      console.error("Reaction handler error:", e);
    }
  });
};
