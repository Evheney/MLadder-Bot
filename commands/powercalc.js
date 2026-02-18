const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { parseValue, formatValue } = require("../utils/number");
const cityTable = require("../tables/cityTable.json");

function parsePercent(raw) {
  // accepts: "200", "200%", "12.5%"
  let s = String(raw).trim();
  s = s.replace("%", "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Bad percent: "${raw}" (use like 200% or 12.5%)`);
  }
  return n;
}

function getBestCityByWall(powerWall) {
  const levels = Object.keys(cityTable)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  let best = null;
  for (const lvl of levels) {
    const wall = Number(cityTable[String(lvl)]?.wall) || 0;
    if (wall <= powerWall) best = { level: lvl, wall };
    else break;
  }

  let next = null;
  if (best) {
    const idx = levels.indexOf(best.level);
    if (idx >= 0 && idx + 1 < levels.length) {
      const nl = levels[idx + 1];
      next = { level: nl, wall: Number(cityTable[String(nl)]?.wall) || 0 };
    }
  } else if (levels.length) {
    const nl = levels[0];
    next = { level: nl, wall: Number(cityTable[String(nl)]?.wall) || 0 };
  }

  return { best, next };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("powercalc")
    .setDescription("Calculate combined wall power using base power + percent, then find closest city level.")
    .addStringOption(opt =>
      opt.setName("power")
        .setDescription("Base power, e.g. 15G, 120M, 700K")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("percent")
        .setDescription("Bonus percent, e.g. 200% (means +200% => total 300%)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const rawPower = interaction.options.getString("power", true);
    const rawPercent = interaction.options.getString("percent", true);

    let base;
    let bonusPct;
    try {
      base = parseValue(rawPower);
      bonusPct = parsePercent(rawPercent);
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }

    // Total percent = 100% + bonus
    const totalPct = 100 + bonusPct;
    const multiplier = totalPct / 100;
    const combined = Math.round(base * multiplier);

    const { best, next } = getBestCityByWall(combined);

    const embed = new EmbedBuilder()
      .setTitle("Power Calc")
      .setDescription(
        `Base: **${formatValue(base)}**\n` +
        `Bonus: **+${bonusPct}%** → Total: **${totalPct}%** (×${multiplier.toFixed(2).replace(/\.00$/, "")})\n` +
        `Combined: **${formatValue(combined)}**`
      );

    if (!best) {
      embed.addFields({
        name: "City result",
        value: next
          ? `Below minimum.\nNext: **Lvl ${next.level}** (Wall **${formatValue(next.wall)}**)`
          : "City table not loaded."
      });
    } else {
      embed.addFields({
        name: "Best city you can hit",
        value: `**Lvl ${best.level}** (Wall **${formatValue(best.wall)}**)`
      });

      if (next && next.wall > 0) {
        const need = Math.max(0, next.wall - combined);
        embed.addFields({
          name: "Next city",
          value: `**Lvl ${next.level}** (Wall **${formatValue(next.wall)}**)\nNeed: **${formatValue(need)}** more`
        });
      }
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
