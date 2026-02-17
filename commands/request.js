const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs/promises");
const path = require("path");

const REQUESTS_PATH = path.join(__dirname, "..", "data", "requests.json");

const PLO_KOON_ID = "426881818764115968";

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function parseLevels(input) {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("No levels provided.");

  const levels = parts.map(x => Number(x));
  if (levels.some(n => !Number.isInteger(n) || n < 1 || n > 200)) {
    throw new Error("Levels must be integers between 1 and 200. Example: `145 144 143`");
  }

  // enforce rule: first is highest, then non-increasing
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1]) {
      throw new Error("Levels must be non-increasing (first highest). Example: `145 144 143`");
    }
  }

  if (levels.length > 4) throw new Error("Max 4 levels per request.");
  return levels;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request builder to build one or more cities (max 4).")
    .addStringOption(opt =>
      opt.setName("levels")
        .setDescription("City levels, e.g. 145 144 143 (max 4, first highest)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString("levels", true);
    const user = interaction.user;

    let levels;
    try {
      levels = parseLevels(raw);
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
  .setTitle("City Build Request")
  .setDescription(
`Player: <@${user.id}>
Requested: **${levels.join(", ")}**

Builder: react with ✅ when built.`
  );

// Ping in content to guarantee notification
const msg = await interaction.reply({
  content: `<@${PLO_KOON_ID}> you have a city to build`,
  embeds: [embed],
  fetchReply: true,
  allowedMentions: {
    users: [PLO_KOON_ID] // ensures ping is not blocked
  }
});

try { await msg.react("✅"); } catch {}

const requests = await readJson(REQUESTS_PATH);
requests[msg.id] = { userId: user.id, levels, createdAt: Date.now() };
await writeJson(REQUESTS_PATH, requests);
  }
};
