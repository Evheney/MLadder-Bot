const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const HITS_PATH = path.join(__dirname, "..", "data", "hits.json");

function loadHits() {
  if (!fs.existsSync(HITS_PATH)) return {};
  return JSON.parse(fs.readFileSync(HITS_PATH, "utf8"));
}

function lastN(arr, n) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(-n);
}

function getTargetLevel(recentHits) {
  // recentHits = last hits, e.g. [144,143,143] (older->newer)
  const valid = recentHits.filter(x => Number.isInteger(x) && x > 0);
  if (valid.length === 0) return null;
  const best = Math.max(...valid);
  return Math.min(best + 1, 200); // cap at 200
}

function buildSuggestions(target) {
  // Always obey: first highest, then non-increasing
  // These are "request bundles" for builder/ladder to provide.

  const s1 = [target];

  // simple: two cities same level
  const s2 = [target, target];

  // for 140+ range: 3 cities, gently decreasing
  const s3 = [target, Math.max(1, target - 1), Math.max(1, target - 1)];

  // for 160+ range: 4 cities, more ramp
  const s4 = [
    target,
    Math.max(1, target - 1),
    Math.max(1, target - 2),
    Math.max(1, target - 3),
  ];

  // decide how many to show
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
    const userId = interaction.user.id;

    const hitsData = loadHits();
    const allHits = hitsData[userId] || [];

    // use last 5 hits to decide
    const recent = lastN(allHits, 5);

    if (recent.length === 0) {
      return interaction.reply({
        content: "❌ No hits recorded yet. Use `/request` and have builder react ✅, then try again.",
        ephemeral: true,
      });
    }

    const target = getTargetLevel(recent);
    if (!target) {
      return interaction.reply({
        content: "❌ Could not determine target level from your hits.",
        ephemeral: true,
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

    // Add up to 4 suggestion fields
    suggestions.slice(0, 4).forEach((bundle, idx) => {
      embed.addFields({
        name: `Option ${idx + 1}`,
        value: `\`${prettyBundle(bundle)}\``,
        inline: false,
      });
    });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
