const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getGuildDataPath, readJson, writeJson } = require("../utils/storage");

const PLO_KOON_ID = "426881818764115968"; // <-- FIX: paste the real copied user ID

function parseLevels(input) {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("No levels provided.");

  const levels = parts.map(x => Number(x));
  if (levels.some(n => !Number.isInteger(n) || n < 1 || n > 200)) {
    throw new Error("Levels must be integers between 1 and 200. Example: `145 144 143`");
  }

  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1]) {
      throw new Error("Levels must be non-increasing (first highest). Example: `145 144 143`");
    }
  }

  if (levels.length > 4) throw new Error("Max 4 levels per request.");
  return levels;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request builder to build one or more cities (max 4).")
    .addStringOption(opt =>
      opt.setName("levels")
        .setDescription("City levels, e.g. 145 144 143 (max 4, first highest)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        ephemeral: true
      });
    }

    const raw = interaction.options.getString("levels", true);
    const user = interaction.user;

    let levels;
    try {
      levels = parseLevels(raw);
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle("City Build Request")
      .setDescription(
        `Player: <@${user.id}>\n` +
        `Requested: **${levels.join(", ")}**\n\n` +
        `Builder: react with ✅ when built.`
      );

    const REQUESTS_PATH = getGuildDataPath(guildId, "requests.json");

    const msg = await interaction.reply({
      content: `<@${PLO_KOON_ID}> you have a city to build`,
      embeds: [embed],
      fetchReply: true,
      allowedMentions: { users: [PLO_KOON_ID] }
    });

    try { await msg.react("✅"); } catch {}

    const requests = await readJson(REQUESTS_PATH);
    requests[msg.id] = { userId: user.id, levels, createdAt: Date.now() };
    await writeJson(REQUESTS_PATH, requests);
  }
};

