const {
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const cityTable = require("../tables/cityTable.json");
const { parseValue, formatValue } = require("../utils/number");

const DEFAULT_DELTA_LEVEL = 3;
const DEFENDER_CITY_RETURN_PCT = 50;

/**
 * Helpers
 */
function getCityLevels() {
  return Object.keys(cityTable)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function getCityData(level) {
  const row = cityTable[String(level)];
  if (!row) return null;

  return {
    level: Number(level),
    wall: Number(row.wall),
    upgradeCost: Number(row.upgradeCost),
  };
}

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

function getCityProgressGold(startLevel, targetLevel) {
  if (targetLevel <= startLevel) return 0;

  let total = 0;
  for (let lvl = startLevel + 1; lvl <= targetLevel; lvl++) {
    const row = getCityData(lvl);
    if (!row) throw new Error(`Missing city ${lvl}`);
    total += row.upgradeCost;
  }

  return total;
}

function padRight(value, width) {
  return String(value).padEnd(width, " ");
}

/**
 * Output
 */
function buildResponse(data) {
  const left = 16;
  const right = 16;

  const lines = [];

  lines.push("**MaxProfit Command result:**");
  lines.push(`Start level: **${data.startLevel}**`);
  lines.push(`Retention: **${data.retentionPct}%**`);
  lines.push(`Loss target: **${data.attackerLossPct}%**`);
  lines.push(`Max hit level: **${data.maxHitLevel}**`);
  lines.push(`Target level: **${data.targetLevel}** (max - ${data.deltaLevel})`);
  lines.push("");

  lines.push(`Attack power: **${formatValue(data.attackPower)}**`);
  lines.push(`Target wall: **${formatValue(data.targetWall)}**`);
  lines.push(`City progress gold: **${formatValue(data.cityProgressGold)}**`);
  lines.push(
    `Total defense: **1 + ${(data.defensePct / 100).toFixed(3)} + ${(data.cityDefensePct / 100).toFixed(3)} = ${data.totalMultiplier.toFixed(3)}x**`
  );

  lines.push(`Defender troops: **${formatValue(data.defenderTroops)}**`);
  lines.push(`Attacker losses: **${formatValue(data.attackerLosses)}**`);
  lines.push("");

  lines.push("```");
  lines.push(`${padRight("ATTACKER", left)} | ${padRight("DEFENDER", right)}`);
  lines.push(`${padRight("--------------", left)}-|-${padRight("--------------", right)}`);

  lines.push(
    `${padRight("Gold: " + formatValue(data.attackerGold), left)} | ${padRight("City: " + formatValue(data.defenderCityGold), right)}`
  );

  lines.push(
    `${padRight("EXP: " + formatValue(data.attackerExp), left)} | ${padRight("Salvage: " + formatValue(data.defenderSalvageGold), right)}`
  );

  lines.push(
    `${padRight("", left)} | ${padRight("Total: " + formatValue(data.defenderTotalGold), right)}`
  );

  lines.push(
    `${padRight("Perma: " + formatValue(data.attackerPermanentLoss), left)} | ${padRight("Perma: " + formatValue(data.defenderPermanentLoss), right)}`
  );

  lines.push("```");

  return lines.join("\n");
}

/**
 * Core simulation
 */
function simulate({
  startLevel,
  attackTroops,
  strikerPct,
  scavengerPct,
  defensePct,
  salvagePct,
  deltaLevel,
  retentionPct,
  attackerLossPct,
}) {
  if (attackerLossPct > 95) return null;

  const retentionFactor = retentionPct / 100;
  const attackMultiplier = 1 + (strikerPct / 100) * retentionFactor;
  const attackPower = attackTroops * attackMultiplier;

  const maxHit = getBestCityByWall(attackPower);
  if (!maxHit) return null;

  const targetLevel = Math.max(1, maxHit.level - deltaLevel);
  if (targetLevel <= startLevel) return null;

  const targetCity = getCityData(targetLevel);
  if (!targetCity) return null;

  const cityProgressGold = getCityProgressGold(startLevel, targetLevel);

  const cityDefensePct = targetLevel * 3;
  const totalMultiplier = 1 + defensePct / 100 + cityDefensePct / 100;

  const attackerLosses = attackTroops * (attackerLossPct / 100);
  const survivingTroops = attackTroops - attackerLosses;

  const remainingEffective = survivingTroops * attackMultiplier;

  const defenseEffective =
    attackPower - targetCity.wall - remainingEffective;

  if (defenseEffective <= 0) return null;

  const defenderTroops = defenseEffective / totalMultiplier;
  if (defenderTroops <= 0) return null;

  const defenderPower =
    targetCity.wall + defenderTroops * totalMultiplier;

  if (attackPower <= defenderPower) return null;

  // Gold
  const attackerGold = defenderTroops * (scavengerPct / 100);

  const salvageBase =
    (attackPower - targetCity.wall) / attackMultiplier;

  const defenderSalvageGold =
    Math.max(0, salvageBase) * (salvagePct / 100);

  const defenderCityGold =
    cityProgressGold * (DEFENDER_CITY_RETURN_PCT / 100);

  if (defenderSalvageGold <= defenderCityGold) return null;

  const defenderTotalGold =
    defenderCityGold + defenderSalvageGold;

  // EXP
  const attackerExp =
    3 * defenderTroops + attackerLosses + targetCity.wall;

  const defenderExp =
    attackerLosses * 3 + defenderTroops;

  // Permanent losses (display only)
  const attackerPermanentLoss = attackTroops * 0.10;
  const defenderPermanentLoss = defenderTroops * 0.10;

  // Balanced scoring
  const balanceScore = attackerGold + defenderTotalGold;
  const tie = Math.min(attackerGold, defenderTotalGold);

  return {
    retentionPct,
    attackerLossPct,
    attackPower,
    maxHitLevel: maxHit.level,
    targetLevel,
    targetWall: targetCity.wall,
    cityProgressGold,
    cityDefensePct,
    totalMultiplier,
    defenderTroops,
    attackerLosses,
    attackerGold,
    defenderCityGold,
    defenderSalvageGold,
    defenderTotalGold,
    attackerExp,
    defenderExp,
    attackerPermanentLoss,
    defenderPermanentLoss,
    balanceScore,
    tie,
  };
}

/**
 * Find best outcome
 */
function findBest(params) {
  let best = null;

  for (let r = 50; r <= 100; r++) {
    for (let loss = 50; loss <= 95; loss++) {
      const res = simulate({ ...params, retentionPct: r, attackerLossPct: loss });
      if (!res) continue;

      if (!best) {
        best = res;
        continue;
      }

      if (res.balanceScore > best.balanceScore) {
        best = res;
        continue;
      }

      if (
        res.balanceScore === best.balanceScore &&
        res.tie > best.tie
      ) {
        best = res;
        continue;
      }

      if (
        res.balanceScore === best.balanceScore &&
        res.tie === best.tie &&
        res.retentionPct < best.retentionPct
      ) {
        best = res;
        continue;
      }

      if (
        res.balanceScore === best.balanceScore &&
        res.tie === best.tie &&
        res.retentionPct === best.retentionPct &&
        res.attackerLossPct < best.attackerLossPct
      ) {
        best = res;
      }
    }
  }

  return best;
}

/**
 * Command
 */
module.exports = {
  data: new SlashCommandBuilder()
  .setName("maxprofit")
  .setDescription("Best profit fight optimizer")

  .addIntegerOption(o =>
    o.setName("start_level")
     .setDescription("Current city level")
     .setRequired(true)
  )

  .addStringOption(o =>
    o.setName("attack_troops")
     .setDescription("Attacker troops (e.g. 1.5T)")
     .setRequired(true)
  )

  .addNumberOption(o =>
    o.setName("striker")
     .setDescription("Striker %")
     .setRequired(true)
  )

  .addNumberOption(o =>
    o.setName("scavenger")
     .setDescription("Scavenger %")
     .setRequired(true)
  )

  .addNumberOption(o =>
    o.setName("defense")
     .setDescription("Defender defense %")
     .setRequired(true)
  )

  .addNumberOption(o =>
    o.setName("salvage")
     .setDescription("Defender salvage %")
     .setRequired(true)
  )

  .addIntegerOption(o =>
    o.setName("delta_level")
     .setDescription("Delta from max hit (default 3)")
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

      const best = findBest({
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
          content: "❌ No valid outcome found.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const text = buildResponse({
        startLevel,
        ...best,
        deltaLevel,
        defensePct,
      });

      return interaction.reply({
        content: text,
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      console.error(e);
      return interaction.reply({
        content: `❌ Error: ${e.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};


