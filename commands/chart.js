const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

function shortDay(isoDay) {
  // isoDay = YYYY-MM-DD
  return isoDay.slice(5); // MM-DD
}

function fmtOffset(mins) {
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm} (${mins}m)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chart")
    .setDescription("PNG chart: builds/hits per day for a user (7 or 14 days)")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User to chart (default: you)").setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName("days")
        .setDescription("Window size (7 or 14)")
        .addChoices({ name: "7", value: 7 }, { name: "14", value: 14 })
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

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const days = interaction.options.getInteger("days") || 14;

    // ✅ Pull timezone setting from DB so the chart visibly confirms it
    const offsetMinutes = client.db.getTimezoneOffsetMinutes(guildId);
    const offsetLabel = fmtOffset(offsetMinutes);

    // ✅ Timezone-aware daily series (DB query uses the guild offset)
    const series = client.db.getUserDailySeries(guildId, seasonId, targetUser.id, days);

    const labels = series.map(r => shortDay(r.day));
    const builds = series.map(r => Number(r.builds || 0));
    const hits = series.map(r => Number(r.hits || 0));

    // Display name for title
    let member = guild.members.cache.get(targetUser.id) || null;
    if (!member) member = await guild.members.fetch(targetUser.id).catch(() => null);

    const displayName =
      member?.nickname || targetUser.globalName || targetUser.username || targetUser.id;

    // Optional: show date range from the series itself
    const startDay = series[0]?.day ?? "";
    const endDay = series[series.length - 1]?.day ?? "";

    const width = 1000;
    const height = 500;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: "white",
    });

    const configuration = {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Builds", data: builds },
          { label: "Hits", data: hits },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: `Activity (${days}d) — ${displayName} — Season ${seasonId} — ${offsetLabel} — ${startDay}..${endDay}`,
          },
          legend: { display: true },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration, "image/png");
    const file = new AttachmentBuilder(imageBuffer, {
      name: `activity_${targetUser.id}_${days}d.png`,
    });

    return interaction.editReply({
      content: `📈 Chart for <@${targetUser.id}> (timezone: **${offsetLabel}**)`,
      files: [file],
    });
  },
};