const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const cityTable = require("../tables/cityTable.json");
const formatNumber = require("../tools/FormatNumber.js");

/**
 * Parse defense input.
 *
 * Accepts:
 * - 278
 * - 278%
 * - 278.5
 * - 278.125%
 *
 * Rejects:
 * - values with spaces, like "278 %" or "27 8"
 * - invalid text
 *
 * Returns a number only (percent sign removed if present).
 */
function parseDefenseInput(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Defense is required.");
  }

  // No spaces allowed anywhere in the defense input
  if (/\s/.test(raw)) {
    throw new Error('Defense must be like "278" or "278%". Spaces are not allowed.');
  }

  // Accept: digits with optional decimal part, and optional %
  // Examples: 278 / 278% / 278.5 / 278.125%
  const match = raw.match(/^(\d+(?:\.\d+)?)(%)?$/);
  if (!match) {
    throw new Error('Invalid defense value. Use "278" or "278%".');
  }

  const value = Number(match[1]);

  if (!Number.isFinite(value)) {
    throw new Error("Defense must be a valid number.");
  }

  return value;
}

/**
 * Get wall value for a city level from cityTable.json
 */
function getWallByLevel(level) {
  const row = cityTable[String(level)];

  if (!row) {
    return null;
  }

  const wall = Number(row.wall);

  if (!Number.isFinite(wall)) {
    return null;
  }

  return wall;
}

/**
 * Format result numbers:
 * - defense can show up to 3 decimal places
 * - most other values can be shown with short format if large
 */
function formatDecimal(value, maxDecimals = 1) {
  if (!Number.isFinite(value)) return "0";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("buildcity")
    .setDescription("Calculate units needed to compensate city wall difference.")
    .addIntegerOption(opt =>
      opt
        .setName("requested_level")
        .setDescription("Requested city level")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(opt =>
      opt
        .setName("can_build")
        .setDescription("Highest city level you can build")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt
        .setName("defense")
        .setDescription('Defense bonus, example: 278 or 278%')
        .setRequired(true)
    ),

  async execute(interaction) {
    const requestedLevel = interaction.options.getInteger("requested_level", true);
    const canBuildLevel = interaction.options.getInteger("can_build", true);
    const rawDefense = interaction.options.getString("defense", true);

    // Requested city must be higher than can-build city
    if (requestedLevel <= canBuildLevel) {
      return interaction.reply({
        content: "❌ Requested city level must be higher than the city level you can build.",
        flags: MessageFlags.Ephemeral,
      });
    }

    let defenseBonus;
    try {
      defenseBonus = parseDefenseInput(rawDefense);
    } catch (error) {
      return interaction.reply({
        content: `❌ ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const requestedWall = getWallByLevel(requestedLevel);
    const canBuildWall = getWallByLevel(canBuildLevel);

    if (requestedWall === null) {
      return interaction.reply({
        content: `❌ Requested city level **${requestedLevel}** was not found in cityTable.json.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (canBuildWall === null) {
      return interaction.reply({
        content: `❌ Can-build city level **${canBuildLevel}** was not found in cityTable.json.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Formula:
    // finalDefense = 100 + (canBuildLevel * 3) + defenseBonus
    const finalDefense = 100 + (canBuildLevel * 3) + defenseBonus;

    // Formula:
    // wallDifference = requestedWall - canBuildWall
    const wallDifference = requestedWall - canBuildWall;

    // Formula:
    // unitsNeeded = wallDifference / finalDefense
    const unitsNeeded = wallDifference / finalDefense;

    const embed = new EmbedBuilder()
      .setTitle("Build City Calculator")
      .addFields(
        {
          name: "Requested city",
          value: `Level **${requestedLevel}** (Wall **${formatNumber(requestedWall)}**)`,
          inline: false,
        },
        {
          name: "Can build city",
          value: `Level **${canBuildLevel}** (Wall **${formatNumber(canBuildWall)}**)`,
          inline: false,
        },
        {
          name: "Wall difference",
          value: `**${formatNumber(wallDifference)}**`,
          inline: false,
        },
        {
          name: "Final defense",
          value: `**${formatDecimal(finalDefense, 3)}**`,
          inline: false,
        },
        {
          name: "Units needed to compensate",
          value: `**${formatDecimal(unitsNeeded, 1)}**`,
          inline: false,
        }
      );

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};