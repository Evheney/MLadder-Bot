const {
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const cityTable = require("../tables/cityTable.json");
const { parseValue, formatValue } = require("../utils/number");

// Hardcoded defaults
const DEFAULT_DELTA_LEVEL = 3;
const DEFAULT_LOSS_FACTOR = 87.5;     // percent
const DEFENDER_CITY_RETURN_PCT = 50;  // percent, change if needed

/**
 * Get sorted numeric city levels.
 */
function getCityLevels() {
  return Object.keys(cityTable)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/**
 * Get city row by level.
 */
function getCityData(level) {
  const row = cityTable[String(level)];
  if (!row) return null;

  const wall = Number(row.wall);
  const upgradeCost = Number(row.upgradeCost);

  if (!Number.isFinite(wall) || !Number.isFinite(upgradeCost)) {
    return null;
  }

  return {
    level: Number(level),
    wall,
    upgradeCost,
  };
}

/**
 * Find highest city whose wall is <= attack power.
 */
function getBestCityByWall(powerWall) {
  const levels = getCityLevels();

  let best = null;
  for (const lvl of levels) {
    const row = getCityData(lvl);
    if (!row) continue;

    if (row.wall <= powerWall) {
      best = row;
    } else {
      break;
    }
  }

  return best;
}

/**
 * Sum upgradeCost from startLevel -> targetLevel.
 * Example:
 * start 120, target 123 => sum cost of 121 + 122 + 123
 */
function getCityProgressGold(startLevel, targetLevel) {
  if (targetLevel <= startLevel) return 0;

  let total = 0;
  for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
    const row = getCityData(lvl);
    if (!row) {
      throw new Error(`City level ${lvl} missing or invalid in cityTable.json.`);
    }
    total += row.upgradeCost;
  }

  return total;
}

/**
 * Build the output text.
 */
function padRight(value, width) {
  return String(value).padEnd(width, " ");
}

function buildResponse(data) {
  const leftWidth = 16;
  const rightWidth = 16;

  const lines = [];

  lines.push("**MaxProfit Command result:**");
  lines.push(`Start level: **${data.startLevel}**`);
  lines.push(`Max hit level: **${data.maxHitLevel}**`);
  lines.push(`Target level: **${data.targetLevel}** (max - ${data.deltaLevel})`);
  lines.push("");
  lines.push(`Attack power: **${formatValue(Math.round(data.attackPower))}**`);
  lines.push(`Target wall: **${formatValue(data.targetWall)}**`);
  lines.push(`City progress gold: **${formatValue(Math.round(data.cityProgressGold))}**`);
  lines.push(
    `Total defense: **1 + ${(data.defensePct / 100).toFixed(3)} + ${(data.cityDefensePct / 100).toFixed(3)} = ${data.totalMultiplier.toFixed(3)}x**`
  );
  lines.push(`Best striker retention: **${data.bestStrikerRetention}%**`);
  lines.push(`Defender troops: **${formatValue(Math.floor(data.defenderTroops))}**`);
  lines.push(`Attacker losses: **${formatValue(Math.round(data.attackerLosses))}**`);
  lines.push("");

  lines.push("```");
  lines.push(
    `${padRight("ATTACKER GAINS", leftWidth)} | ${padRight("DEFENDER GAINS", rightWidth)}`
  );
  lines.push(
    `${padRight("----------------", leftWidth)}-|-${padRight("----------------", rightWidth)}`
  );
  lines.push(
    `${padRight("Gold: " + formatValue(Math.round(data.attackerGold)), leftWidth)} | ${padRight("City Gold: " + formatValue(Math.round(data.defenderCityGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("EXP: " + formatValue(Math.round(data.attackerExp)), leftWidth)} | ${padRight("Salvage: " + formatValue(Math.round(data.defenderSalvageGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("", leftWidth)} | ${padRight("Total Gold: " + formatValue(Math.round(data.defenderTotalGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("", leftWidth)} | ${padRight("EXP: " + formatValue(Math.round(data.defenderExp)), rightWidth)}`
  );
  lines.push(
  `${padRight("Perma loss: " + formatValue(Math.round(data.attackerPermanentLoss)), leftWidth)} | ${padRight("Perma loss: " + formatValue(Math.round(data.defenderPermanentLoss)), rightWidth)}`
);
  lines.push("```");

  return lines.join("\n");
}

//helper to calculate the best outcome
function findBestStrikerRetention({
  attackPower,
  targetWall,
  strikerPct,
  salvagePct,
  defenderCityGold,
}) {
  let bestValid = null;
  let bestFallback = null;

  for (let pct = 100; pct >= 5; pct -= 1) {
    const retention = pct / 100;

    // Keep base 1x, reduce only the striker bonus part
    const retainedAttackMultiplier = 1 + (strikerPct / 100) * retention;

    // Convert remaining effective attack back into troop-equivalent base
    const salvageBase =
      retainedAttackMultiplier > 0
        ? Math.max(0, (attackPower - targetWall) / retainedAttackMultiplier)
        : 0;

    const defenderSalvageGold = salvageBase * (salvagePct / 100);
    const defenderTotalGold = defenderCityGold + defenderSalvageGold;

    const candidate = {
      retentionPct: pct,
      retainedAttackMultiplier,
      salvageBase,
      defenderSalvageGold,
      defenderTotalGold,
      valid: defenderSalvageGold > defenderCityGold,
    };

    if (!bestFallback || candidate.defenderTotalGold > bestFallback.defenderTotalGold) {
      bestFallback = candidate;
    }

    if (candidate.valid) {
      if (!bestValid || candidate.defenderTotalGold > bestValid.defenderTotalGold) {
        bestValid = candidate;
      }
    }
  }

  return bestValid || bestFallback;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("maxprofit")
    .setDescription("Estimate profit build target and defender setup.")
    .addIntegerOption(opt =>
      opt
        .setName("start_level")
        .setDescription("Current city level, e.g. 120")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt
        .setName("attack_troops")
        .setDescription("Attacker troops, e.g. 1.26T")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("striker")
        .setDescription("Attacker striker %, e.g. 363")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("scavenger")
        .setDescription("Attacker scavenger %, e.g. 167")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("defense")
        .setDescription("Defender defense %, e.g. 533")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("salvage")
        .setDescription("Defender salvage %, e.g. 352")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName("delta_level")
        .setDescription("Use max hit level minus this value (default 3)")
        .setRequired(false)
        .setMinValue(0)
    )
    .addNumberOption(opt =>
      opt
        .setName("lossfactor")
        .setDescription("Attacker loss percent, default 87.5")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const startLevel = interaction.options.getInteger("start_level", true);
      const attackTroops = parseValue(interaction.options.getString("attack_troops", true));
      const strikerPct = interaction.options.getNumber("striker", true);
      const scavengerPct = interaction.options.getNumber("scavenger", true);
      const defensePct = interaction.options.getNumber("defense", true);
      const salvagePct = interaction.options.getNumber("salvage", true);
      const deltaLevel = interaction.options.getInteger("delta_level") ?? DEFAULT_DELTA_LEVEL;
      const lossFactorPct = interaction.options.getNumber("lossfactor") ?? DEFAULT_LOSS_FACTOR;

      const startCity = getCityData(startLevel);
      if (!startCity) {
        return interaction.reply({
          content: `❌ Start city level **${startLevel}** was not found in cityTable.json.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // 1) Attacker power
      const attackMultiplier = 1 + strikerPct / 100;
      const attackPower = attackTroops * attackMultiplier;

      // 2) Highest city attacker can beat by wall only
      const maxHitCity = getBestCityByWall(attackPower);
      if (!maxHitCity) {
        return interaction.reply({
          content: "❌ Attacker power is below the minimum city wall in cityTable.json.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // 3) Apply delta
      const targetLevel = maxHitCity.level - deltaLevel;
      if (targetLevel < 1) {
        return interaction.reply({
          content: `❌ Delta is too large. Max hit is level **${maxHitCity.level}**, so target level becomes invalid.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (targetLevel <= startLevel) {
        return interaction.reply({
          content: `❌ Target level **${targetLevel}** is not above start level **${startLevel}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const targetCity = getCityData(targetLevel);
      if (!targetCity) {
        return interaction.reply({
          content: `❌ Target city level **${targetLevel}** was not found in cityTable.json.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // 4) Gold needed from start -> target
      const cityProgressGold = getCityProgressGold(startLevel, targetLevel);

      // 5) Defender total multiplier at target city
      const cityDefensePct = targetLevel * 3;
      const totalMultiplier = 1 + (defensePct / 100) + (cityDefensePct / 100);

      // 6) Defender troops attacker can still beat
      const rawDefenderTroops = (attackPower - targetCity.wall) / totalMultiplier;
      const defenderTroops = Math.max(0, rawDefenderTroops - 1);

      // 7) Attacker troop losses
      const attackerLosses =attackTroops;

      // 8) Gold results
      
      // attacker gold stays same
      const attackerGold = defenderTroops * (scavengerPct / 100);

      // new salvage formula
      const salvageBase = (attackPower - targetCity.wall ) / attackMultiplier;

      // prevent negative salvage (important)
      const defenderCityGold = cityProgressGold * (DEFENDER_CITY_RETURN_PCT / 100);

      // Search best striker retention from 100% down to 75%
      const bestRetention = findBestStrikerRetention({
        attackPower,
        targetWall: targetCity.wall,
        strikerPct,
        salvagePct,
        defenderCityGold,
      });

      const defenderSalvageGold = bestRetention.defenderSalvageGold;
      const defenderTotalGold = bestRetention.defenderTotalGold;    

      const attackerExp =(3 * defenderTroops) + attackerLosses + targetCity.wall;

      // TEMP formula - change if needed
      const defenderExp = attackerLosses * 3 + defenderTroops;

      const attackerPermanentLoss = attackerLosses * 0.10;
      const defenderPermanentLoss = defenderTroops * 0.10;

      const text = buildResponse({
        startLevel,
        maxHitLevel: maxHitCity.level,
        targetLevel,
        deltaLevel,
        attackPower,
        targetWall: targetCity.wall,
        cityProgressGold,
        defensePct,
        cityDefensePct,
        totalMultiplier,
        bestStrikerRetention: bestRetention.retentionPct,
        defenderTroops,
        attackerLosses,
        attackerGold,
        defenderCityGold,
        defenderSalvageGold,
        defenderTotalGold,
        attackerExp,
        defenderExp,
        attackerPermanentLoss,
        defenderPermanentLoss, // ← add this
      });

      return interaction.reply({
        content: text,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("profittest command error:", err);

      if (interaction.replied || interaction.deferred) return;

      return interaction.reply({
        content: `❌ Error: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};