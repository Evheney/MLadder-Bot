const { Events } = require("discord.js");
const { getGuildDataPath, readJson, writeJson } = require("../utils/storage");

const MAX_HITS_PER_USER = 50;

module.exports = function registerReactionAddHandler(client) {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      if (user.bot) return;

      // handle partials (you enabled partials in index.js)
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      if (reaction.emoji.name !== "✅") return;

      const guildId = reaction.message.guildId;
      if (!guildId) return; // ignore DMs

      const messageId = reaction.message.id;

      const REQUESTS_PATH = getGuildDataPath(guildId, "requests.json");
      const HITS_PATH = getGuildDataPath(guildId, "hits.json");

      const requests = await readJson(REQUESTS_PATH);
      const req = requests[messageId];
      if (!req) return;

      const levels = Array.isArray(req.levels)
        ? req.levels
        : (req.level ? [req.level] : []);

      if (levels.length === 0) return;

      const hits = await readJson(HITS_PATH);
      const arr = Array.isArray(hits[req.userId]) ? hits[req.userId] : [];

      for (const lvl of levels) arr.push(lvl);

      hits[req.userId] = arr.length > MAX_HITS_PER_USER
        ? arr.slice(-MAX_HITS_PER_USER)
        : arr;

      await writeJson(HITS_PATH, hits);

      // delete request so it can't be counted twice
      delete requests[messageId];
      await writeJson(REQUESTS_PATH, requests);

      // mark complete (visible to everyone)
      try { await reaction.message.react("🟩"); } catch {}
    } catch (e) {
      console.error("Reaction handler error:", e);
    }
  });
};
