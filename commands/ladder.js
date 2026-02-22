const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const valorStore = require("../utils/valorStore");
const { formatValue } = require("../utils/number");

function pct(a, b) {
  if (!a || !b) return 0;
  return (a / b) * 100;
}

function fmtPct(x) {
  return `${x.toFixed(1)}%`;
}

function findTopBuilder(all) {
  const builders = Object.entries(all)
    .filter(([_, v]) => v.type === "builder" && Number(v.valor) > 0)
    .map(([id, v]) => ({ userId: id, valor: v.valor }))
    .sort((a, b) => b.valor - a.valor);

  return builders[0] || null;
}

function closestAbove(list, myValor, limit) {
  return list
    .filter(x => x.valor > myValor)
    .sort((a, b) => a.valor - b.valor)
    .slice(0, limit);
}

function closestBelow(list, myValor, limit) {
  return list
    .filter(x => x.valor < myValor)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ladder")
    .setDescription("Show ladder % vs builder, stronger, and weaker"),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        flags: MessageFlags.Ephemeral
      });
    }

    const userId = interaction.user.id;

    const all = await valorStore.getAll(guildId);
    const me = all[userId];

    if (!me || !me.valor) {
      return interaction.reply({
        content: "❌ You don't have valor saved. Use `/valor 5G` first.",
        flags: MessageFlags.Ephemeral
      });
    }

    const topBuilder = findTopBuilder(all);
    if (!topBuilder) {
      return interaction.reply({
        content: "❌ No builder valor set yet. A builder must use `/buildervalor` first.",
        flags: MessageFlags.Ephemeral
      });
    }

    const myValor = Number(me.valor);
    const builderValor = Number(topBuilder.valor);

    const myToBuilder = pct(myValor, builderValor);
    const inLadderRange = myToBuilder >= 30 && myToBuilder <= 100;

    const everyone = Object.entries(all)
      .filter(([id, v]) => id !== userId && Number(v.valor) > 0)
      .map(([id, v]) => ({ userId: id, valor: Number(v.valor), type: v.type }));

    const stronger = closestAbove(everyone, myValor, 5);
    const weaker = closestBelow(everyone, myValor, 6);

    const embed = new EmbedBuilder()
      .setTitle("Ladder")
      .setDescription(
        `Top builder: <@${topBuilder.userId}> • **${formatValue(builderValor)}**\n` +
        `You: <@${userId}> • **${formatValue(myValor)}**\n` +
        `Your % to builder: **${fmtPct(myToBuilder)}**\n` +
        `Status: **${inLadderRange ? "✅ In ladder range (30–100%)" : "⚠️ Outside ladder range"}**`
      );

    if (!inLadderRange) {
      if (stronger.length) {
        const lines = stronger.map(s => {
          const sToBuilder = pct(s.valor, builderValor);
          const youToS = pct(myValor, s.valor);
          return `<@${s.userId}> • ${formatValue(s.valor)} • ` +
                 `to builder: ${fmtPct(sToBuilder)} • you→them: ${fmtPct(youToS)}`;
        });

        embed.addFields({ name: "Stronger than you (closest)", value: lines.join("\n") });
      } else {
        embed.addFields({ name: "Stronger than you (closest)", value: "None found." });
      }
    }

    if (weaker.length) {
      const lines = weaker.map(w => {
        const wToYou = pct(w.valor, myValor);
        return `<@${w.userId}> • ${formatValue(w.valor)} • to you: ${fmtPct(wToYou)}`;
      });

      embed.addFields({ name: "Weaker than you (closest)", value: lines.join("\n") });
    } else {
      embed.addFields({ name: "Weaker than you (closest)", value: "None found." });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
