const { SlashCommandBuilder } = require("discord.js");
const { parseValue, formatValue } = require("../utils/number");
const valorStore = require("../utils/valorStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("valor")
    .setDescription("Set or view your valor (players)")
    .addStringOption(opt =>
      opt.setName("amount")
        .setDescription("Your valor, e.g. 5G, 120M, 700K")
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        ephemeral: true
      });
    }

    const raw = interaction.options.getString("amount", false);

    // View
    if (!raw) {
      const rec = await valorStore.getUser(guildId, interaction.user.id);
      if (!rec) {
        return interaction.reply({
          content: "No valor saved yet on this server. Use `/valor 5G`.",
          ephemeral: true
        });
      }
      return interaction.reply({
        content: `Your saved valor: **${formatValue(rec.valor)}** (type: ${rec.type})`,
        ephemeral: true
      });
    }

    // Set
    let v;
    try {
      v = parseValue(raw);
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }

    await valorStore.upsert(guildId, interaction.user.id, v, "player");

    return interaction.reply({
      content: `Saved your valor as **${formatValue(v)}** (player) for this server.`,
      ephemeral: true
    });
  }
};
