const {
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const cityTable = require("../tables/cityTable.json");
const { parseValue, formatValue } = require("../utils/number");

const DEFAULT_DELTA_LEVEL = 3;
const DEFENDER_CITY_RETURN_PCT = 50;

/**
 * Read and validate city data
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
 * Sorted numeric levels from city table
 */
function getCityLevels() {
  return Object.keys(cityTable)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/**
 * Highest city whose wall is <= power
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
 * Gold needed to build from start -> target
 * Example:
 * start 120 target 123 => cost of 121 + 122 + 123
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
 * Small text helpers
 */
function padRight(value, width) {
  return String(value).padEnd(width, " ");
}

/**
 * Build final output
 */
function buildResponse(data) {
  const leftWidth = 15;
  const rightWidth = 15;

  const lines = [];

  lines.push("**MaxProfit result:**");
  lines.push(`Start level: **${data.startLevel}**`);
  lines.push(`Retention: **${data.retentionPct}%**`);
  lines.push(`Defender fill: **${data.defenderFillPct}%** of max`);
  lines.push(`Max hit level: **${data.maxHitLevel}**`);
  lines.push(`Target level: **${data.targetLevel}** (max - ${data.deltaLevel})`);
  lines.push("");

  lines.push(`Attack power: **${formatValue(Math.round(data.attackPower))}**`);
  lines.push(`Target wall: **${formatValue(Math.round(data.targetWall))}**`);
  lines.push(`City progress gold: **${formatValue(Math.round(data.cityProgressGold))}**`);
  lines.push(
    `Total defense: **1 + ${(data.defensePct / 100).toFixed(3)} + ${(data.cityDefensePct / 100).toFixed(3)} = ${data.totalMultiplier.toFixed(3)}x**`
  );
  lines.push(`Max defender troops: **${formatValue(Math.floor(data.maxDefenderTroops))}**`);
  lines.push(`Defender troops used: **${formatValue(Math.floor(data.defenderTroops))}**`);
  lines.push(`Attacker losses: **${formatValue(Math.round(data.attackerLosses))}** (${data.attackerLossPct.toFixed(2)}%)`);
  lines.push("");

  lines.push("```");
  lines.push(
    `${padRight("ATTACKER", leftWidth)} | ${padRight("BUILDER", rightWidth)}`
  );
  lines.push(
    `${padRight("---------------", leftWidth)}-|-${padRight("---------------", rightWidth)}`
  );
  lines.push(
    `${padRight("Gold: " + formatValue(Math.round(data.attackerGold)), leftWidth)} | ${padRight("City: " + formatValue(Math.round(data.builderCityGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("EXP: " + formatValue(Math.round(data.attackerExp)), leftWidth)} | ${padRight("Salvage: " + formatValue(Math.round(data.builderSalvageGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("Perma: " + formatValue(Math.round(data.attackerPermanentLoss)), leftWidth)} | ${padRight("Total: " + formatValue(Math.round(data.builderTotalGold)), rightWidth)}`
  );
  lines.push(
    `${padRight("", leftWidth)} | ${padRight("EXP: " + formatValue(Math.round(data.builderExp)), rightWidth)}`
  );
  lines.push(
    `${padRight("", leftWidth)} | ${padRight("Perma: " + formatValue(Math.round(data.builderPermanentLoss)), rightWidth)}`
  );
  lines.push("```");

  return lines.join("\n");
}

/**
 * Simulate one candidate:
 * - retention changes attack multiplier
 * - defender fill chooses how close to max beatable troops the builder goes
 * - attacker losses are derived from actual fight pressure
 */
function simulateCandidate({
  startLevel,
  attackTroops,
  strikerPct,
  scavengerPct,
  defensePct,
  salvagePct,
  deltaLevel,
  retentionPct,
  defenderFillPct,
}) {
  const retentionFactor = retentionPct / 100;

  // Retention affects only striker bonus
  const attackMultiplier = 1 + (strikerPct / 100) * retentionFactor;
  const attackPower = attackTroops * attackMultiplier;

  const maxHitCity = getBestCityByWall(attackPower);
  if (!maxHitCity) {
    return { ok: false, reason: "noMaxHitCity" };
  }

  const targetLevel = Math.max(1, maxHitCity.level - deltaLevel);
  if (targetLevel <= startLevel) {
    return { ok: false, reason: "targetNotAboveStart" };
  }

  const targetCity = getCityData(targetLevel);
  if (!targetCity) {
    return { ok: false, reason: "invalidTargetCity" };
  }

  const cityProgressGold = getCityProgressGold(startLevel, targetLevel);

  // Builder defense
  const cityDefensePct = targetLevel * 3;
  const totalMultiplier = 1 + (defensePct / 100) + (cityDefensePct / 100);

  // Maximum defender troops attacker can still beat
  const rawMaxDefenderTroops = (attackPower - targetCity.wall) / totalMultiplier;
  if (!Number.isFinite(rawMaxDefenderTroops) || rawMaxDefenderTroops <= 0) {
    return { ok: false, reason: "nonPositiveMaxDefenderTroops" };
  }

  const maxDefenderTroops = rawMaxDefenderTroops;
  const defenderTroops = maxDefenderTroops * (defenderFillPct / 100);

  if (!Number.isFinite(defenderTroops) || defenderTroops <= 0) {
    return { ok: false, reason: "nonPositiveDefenderTroops" };
  }

  // Confirm attacker still wins
  const defenderPower = targetCity.wall + defenderTroops * totalMultiplier;
  if (!(attackPower > defenderPower)) {
    return { ok: false, reason: "attackerDoesNotWin" };
  }

  // Post-wall attack budget
  const postWallAttackPower = attackPower - targetCity.wall;
  if (postWallAttackPower <= 0) {
    return { ok: false, reason: "noPostWallAttack" };
  }

  const defenseEffective = defenderTroops * totalMultiplier;
  const fightPressure = defenseEffective / postWallAttackPower;

  // REAL attacker loss from pressure
  const rawAttackerLossPct = Math.max(0, fightPressure * 100);

  // Hard reject if attacker would have less than 5% surviving troops
  if (rawAttackerLossPct > 95) {
    return { ok: false, reason: "attackerLossTooHigh" };
  }

  const attackerLossPct = rawAttackerLossPct;
  const attackerLosses = attackTroops * (attackerLossPct / 100);
  const survivingTroops = attackTroops - attackerLosses;

  if (survivingTroops < attackTroops * 0.05) {
    return { ok: false, reason: "attackerSurvivalTooLow" };
  }

  // Gold
  const attackerGold = defenderTroops * (scavengerPct / 100);

  const builderSalvageGold =
  attackerLosses * ((defenseEffective - targetCity.wall) / defenseEffective) * (salvagePct / 100);
  const builderCityGold = cityProgressGold * (DEFENDER_CITY_RETURN_PCT / 100);

  if (!(builderSalvageGold > builderCityGold)) {
    return { ok: false, reason: "salvageNotAboveCityGold" };
  }

  const builderTotalGold = builderCityGold + builderSalvageGold;

  // EXP
  const attackerExp = (3 * defenderTroops) + attackerLosses + targetCity.wall;
  const builderExp = (3 * attackerLosses) + defenderTroops;

  // Permanent losses shown only
  const attackerPermanentLoss = attackTroops * 0.10;
  const builderPermanentLoss = defenderTroops * 0.10;

  // Strongly consider attacker losses in scoring
  const attackerValue =
    attackerGold - attackerPermanentLoss - (attackerLosses * 0.25);

  const builderValue =
    builderTotalGold - builderPermanentLoss;

  const balanceScore = Math.min(attackerValue, builderValue);
  const totalValue = attackerValue + builderValue;

  return {
    ok: true,
    result: {
      retentionPct,
      defenderFillPct,
      attackPower,
      attackMultiplier,
      maxHitLevel: maxHitCity.level,
      targetLevel,
      targetWall: targetCity.wall,
      cityProgressGold,
      cityDefensePct,
      totalMultiplier,
      maxDefenderTroops,
      defenderTroops,
      attackerLossPct,
      attackerLosses,
      survivingTroops,
      attackerGold,
      attackerExp,
      attackerPermanentLoss,
      builderCityGold,
      builderSalvageGold,
      builderTotalGold,
      builderExp,
      builderPermanentLoss,
      attackerValue,
      builderValue,
      balanceScore,
      totalValue,
    },
  };
}

/**
 * Find best result.
 *
 * We test:
 * - retention 50%..100%
 * - defender fill 50%..99% of max beatable troops
 *
 * Preference:
 * 1) bigger balanceScore  (good for both)
 * 2) bigger totalValue
 * 3) lower retention
 * 4) lower attacker loss %
 */
function findBestOutcome(params) {
  let best = null;

  const reasons = {
    noMaxHitCity: 0,
    targetNotAboveStart: 0,
    invalidTargetCity: 0,
    nonPositiveMaxDefenderTroops: 0,
    nonPositiveDefenderTroops: 0,
    attackerDoesNotWin: 0,
    noPostWallAttack: 0,
    attackerLossTooHigh: 0,
    attackerSurvivalTooLow: 0,
    salvageNotAboveCityGold: 0,
  };

  for (let retentionPct = 50; retentionPct <= 100; retentionPct += 1) {
    for (let defenderFillPct = 50; defenderFillPct <= 90; defenderFillPct += 1) {
      const sim = simulateCandidate({
        ...params,
        retentionPct,
        defenderFillPct,
      });

      if (!sim.ok) {
        if (reasons[sim.reason] !== undefined) {
          reasons[sim.reason] += 1;
        }
        continue;
      }

      const result = sim.result;

      if (!best) {
        best = result;
        continue;
      }

      if (result.balanceScore > best.balanceScore) {
        best = result;
        continue;
      }

      if (
        result.balanceScore === best.balanceScore &&
        result.totalValue > best.totalValue
      ) {
        best = result;
        continue;
      }

      if (
        result.balanceScore === best.balanceScore &&
        result.totalValue === best.totalValue &&
        result.retentionPct < best.retentionPct
      ) {
        best = result;
        continue;
      }

      if (
        result.balanceScore === best.balanceScore &&
        result.totalValue === best.totalValue &&
        result.retentionPct === best.retentionPct &&
        result.attackerLossPct < best.attackerLossPct
      ) {
        best = result;
      }
    }
  }

  return { best, reasons };
}

function buildNoOutcomeResponse(reasons) {
  const lines = [];

  lines.push("❌ No valid outcome found.");
  lines.push("");
  lines.push("Main rejection reasons:");
  lines.push(`- No reachable max-hit city: **${reasons.noMaxHitCity}**`);
  lines.push(`- Target level not above start level: **${reasons.targetNotAboveStart}**`);
  lines.push(`- Invalid target city data: **${reasons.invalidTargetCity}**`);
  lines.push(`- Non-positive max defender troops: **${reasons.nonPositiveMaxDefenderTroops}**`);
  lines.push(`- Non-positive defender troops: **${reasons.nonPositiveDefenderTroops}**`);
  lines.push(`- Attacker does not strictly win: **${reasons.attackerDoesNotWin}**`);
  lines.push(`- No post-wall attack power left: **${reasons.noPostWallAttack}**`);
  lines.push(`- Attacker loss above 95%: **${reasons.attackerLossTooHigh}**`);
  lines.push(`- Builder salvage not above city gold: **${reasons.salvageNotAboveCityGold}**`);
  lines.push(`- Attacker survival below 5%: **${reasons.attackerSurvivalTooLow}**`);

  return lines.join("\n");
}

/**
 * Command
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("maxprofit")
    .setDescription("Find the best balanced fight for attacker and builder.")
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
        .setDescription("Attacker troops, e.g. 1.79T")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("striker")
        .setDescription("Attacker striker %, e.g. 820")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("scavenger")
        .setDescription("Attacker scavenger %, e.g. 240")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("defense")
        .setDescription("Builder defense %, e.g. 533")
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt
        .setName("salvage")
        .setDescription("Builder salvage %, e.g. 354")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName("delta_level")
        .setDescription("How many levels below max hit to target (default 3)")
        .setRequired(false)
        .setMinValue(0)
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

      const startCity = getCityData(startLevel);
      if (!startCity) {
        return interaction.reply({
          content: `❌ Start city level **${startLevel}** was not found in cityTable.json.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const { best, reasons } = findBestOutcome({
        startLevel,
        attackTroops,
        strikerPct,
        scavengerPct,
        defensePct,
        salvagePct,
        deltaLevel,
      });

      if (!best) {
        return interaction.reply({
          content: buildNoOutcomeResponse(reasons),
          flags: MessageFlags.Ephemeral,
        });
      }

      const text = buildResponse({
        startLevel,
        defensePct,
        deltaLevel,
        ...best,
      });

      return interaction.reply({
        content: text,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("maxprofit command error:", err);

      if (interaction.replied || interaction.deferred) return;

      return interaction.reply({
        content: `❌ Error: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};