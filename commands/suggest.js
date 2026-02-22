const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { getGuildDataPath, readJson } = require("../utils/storage");

function lastN(arr, n) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(-n);
}

function getTargetLevel(recentHits) {
  const valid = recentHits.filter(x => Number.isInteger(x) && x > 0);
  if (valid.length === 0) return null;
  const best = Math.max(...valid);
  return Math.min(best + 1, 200);
}

function buildSuggestions(target) {
  const s1 = [target];
  const s2 = [target, target];

  const s3 = [
    target,
    Math.max(1, target - 1),
    Math.max(1, target - 1)
  ];

  const s4 = [
    target,
    Math.max(1, target - 1),
    Math.max(1, target - 2),
    Math.max(1, target - 3)
  ];

  if (target >= 160) return [s1, s2, s3, s4];
  if (target >= 140) return [s1, s2, s3];
  return [s1, s2];
}

function prettyBundle(levels) {
  return levels.join(" / ");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Suggest how many cities to request next based on your recent hits."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server.",
        flags: MessageFlags.Ephemeral
      });
    }

    const userId = interaction.user.id;

    const HITS_PATH = getGuildDataPath(guildId, "hits.json");
    const hitsData = await readJson(HITS_PATH);

    const allHits = hitsData[userId] || [];
    const recent = lastN(allHits, 5);

    if (recent.length === 0) {
      return interaction.reply({
        content: "❌ No hits recorded yet. Use `/request` and have builder react ✅, then try again.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = getTargetLevel(recent);
    if (!target) {
      return interaction.reply({
        content: "❌ Could not determine target level from your hits.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const suggestions = buildSuggestions(target);

    const embed = new EmbedBuilder()
      .setTitle("City Request Suggestions")
      .setDescription(
        `Based on your last hits: **${recent.slice().reverse().join(", ")}**\n` +
        `Next target level: **${target}**\n\n` +
        `Use this with: \`/request levels: ...\``
      );

    suggestions.slice(0, 4).forEach((bundle, idx) => {
      embed.addFields({
        name: `Option ${idx + 1}`,
        value: `\`${prettyBundle(bundle)}\``,
        inline: false,
      });
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
