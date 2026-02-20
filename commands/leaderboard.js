const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

function displayNameFromMember(member) {
  return member?.nickname || member?.user?.globalName || member?.user?.username || null;
}

async function formatLeaderboardLines(guild, rows) {
  const lines = [];
  let rank = 1;

  for (const r of rows) {
    const userId = r.user_id;
    const total = Number(r.total || 0);

    let member = guild.members.cache.get(userId) || null;
    if (!member) member = await guild.members.fetch(userId).catch(() => null);

    const name = displayNameFromMember(member) || `<@${userId}>`;
    lines.push(`**${rank}.** ${name} — **${total}**`);
    rank++;
  }

  return lines.length ? lines.join("\n") : "No data yet.";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show leaderboards for builds/hits")
    .addStringOption(opt =>
      opt
        .setName("mode")
        .setDescription("Which leaderboard to show")
        .addChoices(
          { name: "Both", value: "both" },
          { name: "Builds", value: "builds" },
          { name: "Hits", value: "hits" }
        )
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName("limit")
        .setDescription("How many users to show (1-25)")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Use this command in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const guildId = guild.id;
    const seasonId = client.db.getOrCreateSeason(guildId);

    const mode = interaction.options.getString("mode") ?? "both";
    const limit = interaction.options.getInteger("limit") ?? 10;

    const embed = new EmbedBuilder()
      .setTitle("📊 Leaderboards")
      .setFooter({ text: `Season: ${seasonId}` });

    if (mode === "builds" || mode === "both") {
      const buildRows = client.db.getBuildLeaderboard(guildId, seasonId, limit);
      const buildText = await formatLeaderboardLines(guild, buildRows);

      embed.addFields({
        name: "🏗️ Builds (Total Build Count)",
        value: buildText,
        inline: false,
      });
    }

    if (mode === "hits" || mode === "both") {
      const hitRows = client.db.getHitLeaderboard
        ? client.db.getHitLeaderboard(guildId, seasonId, limit)
        : client.db.getLeaderboard(guildId, seasonId, limit); // fallback

      const hitText = await formatLeaderboardLines(guild, hitRows);

      embed.addFields({
        name: "🎯 Hits (Total Hit Count)",
        value: hitText,
        inline: false,
      });
    }

    // If someone chose builds/hits and there's no rows, the field will say "No data yet."
    return interaction.editReply({ embeds: [embed] });
  },
};