const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

function fmtDelta(n) {
  if (n > 0) return `+${n} ↑`;
  if (n < 0) return `${n} ↓`;
  return `0`;
}

async function resolveName(guild, userId) {
  let m = guild.members.cache.get(userId) || null;
  if (!m) m = await guild.members.fetch(userId).catch(() => null);
  if (!m) return `<@${userId}>`;
  return m.nickname || m.user.globalName || m.user.username || `<@${userId}>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Compare activity today vs yesterday")
    .addUserOption(opt =>
      opt
        .setName("user")
        .setDescription("Check specific user instead of everyone")
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName("mode")
        .setDescription("Metric to show")
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
        .setDescription("Limit for global mode (1-25)")
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
    const targetUser = interaction.options.getUser("user");
    const limit = interaction.options.getInteger("limit") ?? 15;

    // Get today/yesterday in Regina TZ
    const dayKeys = client.db.db.prepare(`
      SELECT
        date(datetime('now', '-6 hours')) AS today,
        date(datetime('now', '-6 hours', '-1 day')) AS yesterday
    `).get();

    const todayKey = dayKeys.today;
    const yKey = dayKeys.yesterday;

    // -----------------------
    // USER MODE
    // -----------------------
    if (targetUser) {
      const rows = client.db.getUserDailyTotals(guildId, seasonId, targetUser.id);
      const byDay = new Map(rows.map(r => [r.day, r]));

      const today = byDay.get(todayKey) || { builds: 0, hits: 0 };
      const yest = byDay.get(yKey) || { builds: 0, hits: 0 };

      const tb = Number(today.builds || 0);
      const yb = Number(yest.builds || 0);
      const th = Number(today.hits || 0);
      const yh = Number(yest.hits || 0);

      const name = await resolveName(guild, targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(`📈 Activity: ${name}`)
        .setFooter({ text: `Season ${seasonId} • TZ: America/Regina` });

      if (mode === "builds" || mode === "both") {
        embed.addFields({
          name: "🏗️ Builds",
          value:
            `Today (${todayKey}): **${tb}**\n` +
            `Yesterday (${yKey}): **${yb}**\n` +
            `Δ: **${fmtDelta(tb - yb)}**`,
          inline: true,
        });
      }

      if (mode === "hits" || mode === "both") {
        embed.addFields({
          name: "🎯 Hits",
          value:
            `Today (${todayKey}): **${th}**\n` +
            `Yesterday (${yKey}): **${yh}**\n` +
            `Δ: **${fmtDelta(th - yh)}**`,
          inline: true,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // -----------------------
    // GLOBAL MODE
    // -----------------------

    const rows = client.db.getActivityAll(guildId, seasonId);

    if (!rows.length) {
      return interaction.editReply("No activity recorded for today or yesterday.");
    }

    const sorted = [...rows].sort((a, b) => {
      if (mode === "hits") return b.today_hits - a.today_hits;
      return b.today_builds - a.today_builds;
    });

    const top = sorted.slice(0, limit);

    const lines = [];
    let rank = 1;

    for (const r of top) {
      const name = await resolveName(guild, r.user_id);

      const tb = Number(r.today_builds || 0);
      const yb = Number(r.yesterday_builds || 0);
      const th = Number(r.today_hits || 0);
      const yh = Number(r.yesterday_hits || 0);

      if (mode === "builds") {
        lines.push(
          `**${rank}.** ${name}\n` +
          `Today: **${tb}** | Yesterday: **${yb}** | Δ **${fmtDelta(tb - yb)}**`
        );
      } else if (mode === "hits") {
        lines.push(
          `**${rank}.** ${name}\n` +
          `Today: **${th}** | Yesterday: **${yh}** | Δ **${fmtDelta(th - yh)}**`
        );
      } else {
        lines.push(
          `**${rank}.** ${name}\n` +
          `Builds: ${tb} (${fmtDelta(tb - yb)}) | Hits: ${th} (${fmtDelta(th - yh)})`
        );
      }

      rank++;
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 Activity Overview")
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Season ${seasonId} • Today: ${todayKey} • Yesterday: ${yKey}` });

    return interaction.editReply({ embeds: [embed] });
  },
};