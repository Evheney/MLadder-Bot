const { SlashCommandBuilder } = require("discord.js");
const { parseValue, formatValue } = require("../utils/number");
const valorStore = require("../utils/valorStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("buildervalor")
    .setDescription("Set or view your valor (builders)")
    .addStringOption(opt =>
      opt.setName("amount")
        .setDescription("Builder valor, e.g. 10G, 2.5T")
        .setRequired(false)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString("amount", false);

    // View
    if (!raw) {
      const rec = await valorStore.getUser(interaction.user.id);
      if (!rec) {
        return interaction.reply({ content: "No builder valor saved yet. Use `/buildervalor 10G`.", ephemeral: true });
      }
      return interaction.reply({
        content: `Your saved builder valor: **${formatValue(rec.valor)}** (type: ${rec.type})`,
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

    await valorStore.upsert(interaction.user.id, v, "builder");

    return interaction.reply({
      content: `Saved your valor as **${formatValue(v)}** (builder).`,
      ephemeral: true
    });
  }
};
