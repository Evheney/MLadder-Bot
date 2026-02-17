const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "hits.json");

function loadData() {
  if (!fs.existsSync(dataPath)) return {};
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("hits")
    .setDescription("Show your last 5 city hits"),

  async execute(interaction) {

    const userId = interaction.user.id;

    const data = loadData();

    const userHits = data[userId] || [];

    const last5 = userHits.slice(-5).reverse();

    const embed = new EmbedBuilder()
      .setTitle("Your Last Hits")
      .setColor(0x00AEFF);

    if (last5.length === 0) {
      embed.setDescription("No hits recorded.");
    } else {
      embed.setDescription(
        last5.map((lvl, i) => `#${i + 1}  Level ${lvl}`).join("\n")
      );
    }

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
};
