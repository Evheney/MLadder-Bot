const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getGuildDataPath, readJson } = require("../utils/storage");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("hits")
    .setDescription("Show your last 5 city hits"),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        ephemeral: true
      });
    }

    const userId = interaction.user.id;

    const HITS_PATH = getGuildDataPath(guildId, "hits.json");
    const data = await readJson(HITS_PATH);

    const userHits = Array.isArray(data[userId]) ? data[userId] : [];
    const last5 = userHits.slice(-5).reverse();

    const embed = new EmbedBuilder()
      .setTitle("Your Last Hits");

    if (last5.length === 0) {
      embed.setDescription("No hits recorded for you on this server yet.");
    } else {
      embed.setDescription(
        last5.map((lvl, i) => `#${i + 1}  Level **${lvl}**`).join("\n")
      );
    }

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
};
