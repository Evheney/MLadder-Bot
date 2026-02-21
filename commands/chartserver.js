const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

function shortDay(isoDay) {
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
    .setName("chartserver")
    .setDescription("PNG chart: server total builds/hits per day (7 or 14 days)")
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

    const days = interaction.options.getInteger("days") || 14;

    const offsetMinutes = client.db.getTimezoneOffsetMinutes(guildId);
    const offsetLabel = fmtOffset(offsetMinutes);

    const series = client.db.getServerDailySeries(guildId, seasonId, days);
    const labels = series.map(r => shortDay(r.day));
    const builds = series.map(r => Number(r.builds || 0));
    const hits = series.map(r => Number(r.hits || 0));

    const startDay = series[0]?.day ?? "";
    const endDay = series[series.length - 1]?.day ?? "";

    const width = 1000;
    const height = 500;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: "white",
    });

    const cfg = {
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
            text: `Server Activity (${days}d) — Season ${seasonId} — ${offsetLabel} — ${startDay}..${endDay}`,
          },
          legend: { display: true },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };

    const buf = await chartJSNodeCanvas.renderToBuffer(cfg, "image/png");
    const file = new AttachmentBuilder(buf, { name: `server_activity_${days}d.png` });

    return interaction.editReply({
      content: `📈 Server chart (timezone: **${offsetLabel}**)`,
      files: [file],
    });
  },
};