"use strict";

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

function fmtOffset(mins) {
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm} (${mins}m)`;
}

// Try to get a nice display name for a user id
// Priority:
// 1) DB cached names (members table) via DB method
// 2) Guild cache
// 3) Fetch from Discord API
// 4) userId
async function getDisplayName(guild, client, userId) {
  // 1) DB cache (fast, no API)
  try {
    const row = client.db.getMemberNames(guild.id, userId);
    if (row) return row.nickname || row.global_name || row.username || userId;
  } catch {}

  // 2) Guild cache
  const cached = guild.members.cache.get(userId);
  if (cached) return cached.nickname || cached.user.globalName || cached.user.username || userId;

  // 3) Fetch
  const fetched = await guild.members.fetch(userId).catch(() => null);
  if (fetched) return fetched.nickname || fetched.user.globalName || fetched.user.username || userId;

  return userId;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chartusers")
    .setDescription("PNG chart: per-user totals for last N days (hits/builds)")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("What to chart")
        .addChoices(
          { name: "builds", value: "builds" },
          { name: "hits", value: "hits" },
          { name: "both", value: "both" }
        )
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("Window size (7 or 14)")
        .addChoices({ name: "7", value: 7 }, { name: "14", value: 14 })
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("How many users to show (max 25)")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    client.db.flushActionQueue();

    const guild = interaction.guild;
    const guildId = guild.id;
    const seasonId = client.db.getOrCreateSeason(guildId);

    const mode = interaction.options.getString("mode", true);
    const days = interaction.options.getInteger("days") || 14;
    const limit = interaction.options.getInteger("limit") || 10;

    const offsetMinutes = client.db.getTimezoneOffsetMinutes(guildId);
    const offsetLabel = fmtOffset(offsetMinutes);

    // Pull totals from DB (timezone-aware window via DB)
    let rows = client.db.getUserTotalsWindow(guildId, seasonId, days);

    // Normalize numbers
    rows = rows.map((r) => ({
      user_id: r.user_id,
      builds: Number(r.builds || 0),
      hits: Number(r.hits || 0),
    }));

    // Remove users with 0 across chosen mode
    rows = rows.filter((r) => {
      if (mode === "builds") return r.builds > 0;
      if (mode === "hits") return r.hits > 0;
      return r.builds > 0 || r.hits > 0;
    });

    // Sort by selected metric (make "both" stable)
    rows.sort((a, b) => {
      if (mode === "builds") return b.builds - a.builds;
      if (mode === "hits") return b.hits - a.hits;

      // both: builds desc, then hits desc
      if (b.builds !== a.builds) return b.builds - a.builds;
      return b.hits - a.hits;
    });

    rows = rows.slice(0, limit);

    if (rows.length === 0) {
      return interaction.editReply({
        content: `No activity found for last ${days} days (mode: ${mode}).`,
      });
    }

    // Resolve display names
    const labels = [];
    for (const r of rows) {
      labels.push(await getDisplayName(guild, client, r.user_id));
    }

    const builds = rows.map((r) => r.builds);
    const hits = rows.map((r) => r.hits);

    // Horizontal bars are much easier to read for names
    const width = 1100;
    const height = Math.max(450, 70 + rows.length * 32);

    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: "white",
    });

    const datasets =
      mode === "both"
        ? [
            { label: "Builds", data: builds },
            { label: "Hits", data: hits },
          ]
        : mode === "builds"
        ? [{ label: "Builds", data: builds }]
        : [{ label: "Hits", data: hits }];

    const configuration = {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: false,
        indexAxis: "y",
        plugins: {
          title: {
            display: true,
            text: `Per-user totals — last ${days} days — mode: ${mode} — Season ${seasonId} — ${offsetLabel}`,
          },
          legend: { display: mode === "both" },
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { autoSkip: false } },
        },
      },
    };

    const buf = await chartJSNodeCanvas.renderToBuffer(configuration, "image/png");
    const file = new AttachmentBuilder(buf, { name: `users_${mode}_${days}d.png` });

    return interaction.editReply({
      content: `📊 Per-user chart (${mode}, last ${days} days).`,
      files: [file],
    });
  },
};