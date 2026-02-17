const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { parseValue, formatValue } = require("../utils/number");
const cityTable = require("../tables/cityTable.json");

function getBestCityByWall(powerWall) {
  // cityTable keys are strings "1".."200"
  const levels = Object.keys(cityTable)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  let best = null;
  for (const lvl of levels) {
    const row = cityTable[String(lvl)];
    if (!row) continue;
    const wall = Number(row.wall) || 0;

    if (wall <= powerWall) {
      best = { level: lvl, wall };
    } else {
      break; // since levels sorted ascending, we can stop early
    }
  }

  // find next level after best (for "next target")
  let next = null;
  if (best) {
    const idx = levels.indexOf(best.level);
    if (idx >= 0 && idx + 1 < levels.length) {
      const nextLvl = levels[idx + 1];
      next = {
        level: nextLvl,
        wall: Number(cityTable[String(nextLvl)]?.wall) || 0,
      };
    }
  } else {
    // no city fits; show the smallest one
    const firstLvl = levels[0];
    if (firstLvl !== undefined) {
      next = {
        level: firstLvl,
        wall: Number(cityTable[String(firstLvl)]?.wall) || 0,
      };
    }
  }

  return { best, next };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("power")
    .setDescription("Find the highest city level whose wall is <= your power.")
    .addStringOption(opt =>
      opt
        .setName("wall")
        .setDescription("Your wall power, e.g. 5G, 120M, 700K")
        .setRequired(true)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString("wall", true);

    let powerWall;
    try {
      powerWall = parseValue(raw);
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }

    const { best, next } = getBestCityByWall(powerWall);

    if (!best) {
      // user too weak for even the smallest city (or table missing)
      if (!next) {
        return interaction.reply({ content: "❌ City table is empty or not loaded.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle("City lookup by power")
        .setDescription(`Your power: **${formatValue(powerWall)}**`)
        .addFields(
          { name: "Result", value: "You are below the minimum city wall in the table." },
          { name: "Minimum city", value: `Level **${next.level}** (Wall **${formatValue(next.wall)}**)` }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle("City lookup by power")
      .setDescription(`Your power: **${formatValue(powerWall)}**`)
      .addFields(
        { name: "Best match (≤ power)", value: `Level **${best.level}**\nWall: **${formatValue(best.wall)}**` }
      );

    if (next && next.wall > 0) {
      const gap = next.wall - powerWall;
      embed.addFields({
        name: "Next level",
        value: `Level **${next.level}**\nWall: **${formatValue(next.wall)}**\nNeed: **${formatValue(gap)}** more`,
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
