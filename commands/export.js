"use strict";

const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  AttachmentBuilder,
} = require("discord.js");

// Same units you mentioned
const units = [
  { value: 1e15, symbol: "P" },
  { value: 1e12, symbol: "T" },
  { value: 1e9, symbol: "G" },
  { value: 1e6, symbol: "M" },
  { value: 1e3, symbol: "K" },
];

function formatValor(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num <= 0) return "0";
  if (num < 1000) return String(Math.trunc(num));

  for (const u of units) {
    if (num >= u.value) {
      const v = num / u.value;
      const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
      return `${s.replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${u.symbol}`;
    }
  }
  return String(Math.trunc(num));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function canRunAdminOrAboveBot(interaction) {
  const member = interaction.member;
  const botMember = interaction.guild?.members?.me;
  if (!member || !interaction.guild) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  if (botMember?.roles?.highest && member.roles.highest.position > botMember.roles.highest.position) {
    return true;
  }
  return false;
}

async function resolveDisplayName(guild, userId, meta) {
  // DB meta first
  const dbName = meta?.nickname || meta?.global_name || meta?.username;
  if (dbName && dbName.trim()) return dbName.trim();

  // Cache
  const cached = guild.members.cache.get(userId);
  if (cached) return cached.nickname || cached.user.globalName || cached.user.username || userId;

  // Fetch
  const fetched = await guild.members.fetch(userId).catch(() => null);
  if (fetched) return fetched.nickname || fetched.user.globalName || fetched.user.username || userId;

  return userId;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export")
    .setDescription("Export CSV of league totals (names + bot roles + valor)")
    .addStringOption((opt) =>
      opt
        .setName("scope")
        .setDescription("Export current season totals or last N days")
        .addChoices(
          { name: "season", value: "season" },
          { name: "window", value: "window" }
        )
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("Only if scope=window (7 or 14)")
        .addChoices({ name: "7", value: 7 }, { name: "14", value: 14 })
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("sort_by")
        .setDescription("Sort results by")
        .addChoices(
          { name: "builds", value: "builds" },
          { name: "hits", value: "hits" },
          { name: "total (builds+hits)", value: "total" }
        )
        .setRequired(false)
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
    }
    if (!canRunAdminOrAboveBot(interaction)) {
      return interaction.reply({
        content:
          "❌ You don't have permission.\n" +
          "Allowed: **Administrator** OR your highest role must be **above the bot's highest role**.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const guildId = guild.id;
    const seasonId = client.db.getOrCreateSeason(guildId);

    const scope = interaction.options.getString("scope", true);
    const days = interaction.options.getInteger("days") || 14;
    const sortBy = interaction.options.getString("sort_by") || "builds";

    // 1) Totals (from actions)
    let totals =
      scope === "season"
        ? client.db.getUserTotalsSeason(guildId, seasonId)
        : client.db.getUserTotalsWindow(guildId, seasonId, days);

    totals = (totals || []).map((r) => ({
      user_id: r.user_id,
      builds: Number(r.builds || 0),
      hits: Number(r.hits || 0),
    }));

    if (totals.length === 0) {
      return interaction.editReply("No actions found to export.");
    }

    // 2) Bulk member meta (DB)
    const ids = totals.map((r) => r.user_id);
    const metaRows = client.db.getMembersMetaByIds(guildId, ids) || [];
    const metaMap = new Map(metaRows.map((r) => [r.user_id, r]));

    // 3) Enrich + resolve names
    const rows = [];
    for (const t of totals) {
      const meta = metaMap.get(t.user_id);

      const displayName = await resolveDisplayName(guild, t.user_id, meta);

      const botRole = meta?.bot_role || "";
      const valorRaw = Number(meta?.valor || 0);
      const valorFmt = formatValor(valorRaw);

      rows.push({
        user_id: t.user_id,
        display_name: displayName,
        bot_role: botRole,
        builds: t.builds,
        hits: t.hits,
        total: t.builds + t.hits,
        valor_raw: valorRaw,
        valor_fmt: valorFmt,
      });
    }

    // 4) Sort
    rows.sort((a, b) => {
      if (sortBy === "hits") return b.hits - a.hits;
      if (sortBy === "total") return b.total - a.total;
      return b.builds - a.builds;
    });

    // 5) CSV
    const header = [
      "display_name",
      "bot_role",
      "builds",
      "hits",
      "total",
      "valor_fmt",
      "valor_raw",
      "user_id",
    ].join(",");

    const lines = rows.map((r) =>
      [
        csvEscape(r.display_name),
        csvEscape(r.bot_role),
        r.builds,
        r.hits,
        r.total,
        csvEscape(r.valor_fmt),
        r.valor_raw,
        r.user_id,
      ].join(",")
    );

    const csv = header + "\n" + lines.join("\n");
    const buf = Buffer.from(csv, "utf8");

    const filename =
      scope === "season"
        ? `export_season_${seasonId}.csv`
        : `export_window_${days}d_season_${seasonId}.csv`;

    const file = new AttachmentBuilder(buf, { name: filename });

    const scopeLabel =
      scope === "season"
        ? `Current season (season_id=${seasonId})`
        : `Last ${days} days (timezone-aware)`;

    return interaction.editReply({
      content:
        `📦 Export ready: **${scopeLabel}**\n` +
        `Columns: display_name, bot_role, builds, hits, total, valor_fmt, valor_raw, user_id`,
      files: [file],
    });
  },
};