"use strict";

const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
  AttachmentBuilder,
} = require("discord.js");

// =========================================================
// Helpers: formatting
// =========================================================
const units = [
  { value: 1e15, symbol: "P" },
  { value: 1e12, symbol: "T" },
  { value: 1e9, symbol: "G" },
  { value: 1e6, symbol: "M" },
  { value: 1e3, symbol: "K" },
];

function formatValor(raw) {
  const num = Number(raw || 0);
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

function todayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

// =========================================================
// Helpers: permissions
// =========================================================
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

// =========================================================
// Helpers: names (DB -> cache -> fetch)
// =========================================================
async function resolveDisplayName(guild, client, userId) {
  // DB cached names first
  const meta = client.db.getMemberNames(guild.id, userId);
  if (meta) {
    const dbName = meta.nickname || meta.global_name || meta.username;
    if (dbName && dbName.trim()) return dbName.trim();
  }

  // Guild cache
  const cached = guild.members.cache.get(userId);
  if (cached) return cached.nickname || cached.user.globalName || cached.user.username || userId;

  // Fetch
  const fetched = await guild.members.fetch(userId).catch(() => null);
  if (fetched) return fetched.nickname || fetched.user.globalName || fetched.user.username || userId;

  return userId;
}

function fmtUnix(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return String(ts);
  }
}

// =========================================================
// Export builders
// =========================================================
async function buildSeasonTotalsCsv({ guild, client, guildId, seasonId }) {
  // Totals from actions (DB)
  let totals = client.db.getUserTotalsSeason(guildId, seasonId) || [];
  totals = totals.map((r) => ({
    user_id: r.user_id,
    builds: Number(r.builds || 0),
    hits: Number(r.hits || 0),
  }));

  // Always output valid CSV
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

  if (totals.length === 0) {
    return Buffer.from(header + "\n", "utf8");
  }

  const rows = [];
  for (const t of totals) {
    const meta = client.db.getMemberNames(guildId, t.user_id); // DB cached member row
    const displayName = await resolveDisplayName(guild, client, t.user_id);

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
      valor_fmt: valorFmt,
      valor_raw: valorRaw,
    });
  }

  // Most servers expect builds-first ranking
  rows.sort((a, b) => b.builds - a.builds);

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
  return Buffer.from(csv, "utf8");
}

async function buildSeasonDailyCsv({ guild, client, guildId, seasonId }) {
  const header = [
    "day",
    "display_name",
    "bot_role",
    "builds",
    "hits",
    "valor_fmt",
    "valor_raw",
    "user_id",
  ].join(",");

  const daily = client.db.exportDailySeason(guildId, seasonId) || [];
  if (daily.length === 0) {
    return Buffer.from(header + "\n", "utf8");
  }

  const lines = [];
  for (const r of daily) {
    const displayName = await resolveDisplayName(guild, client, r.user_id);

    const valorRaw = Number(r.valor_raw || 0);
    const valorFmt = formatValor(valorRaw);

    lines.push(
      [
        r.day, // YYYY-MM-DD from SQL
        csvEscape(displayName),
        csvEscape(r.bot_role || ""),
        Number(r.builds || 0),
        Number(r.hits || 0),
        csvEscape(valorFmt),
        valorRaw,
        r.user_id,
      ].join(",")
    );
  }

  const csv = header + "\n" + lines.join("\n");
  return Buffer.from(csv, "utf8");
}

// =========================================================
// Command
// =========================================================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("season")
    .setDescription("Season management (admin only)")
    .addSubcommand((sc) =>
      sc
        .setName("start")
        .setDescription("Auto-export current season CSVs, then activate a new season number")
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("Season number (example: 1, 2, 3...)")
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("export")
        .setDescription("Export totals + daily CSV for a specific season (does not change active season)")
        .addIntegerOption((opt) =>
          opt
            .setName("season_id")
            .setDescription("Season number to export (example: 1, 2, 3...)")
            .setMinValue(1)
            .setRequired(true)
        )
    )
    .addSubcommand((sc) =>
        sc
            .setName("list")
            .setDescription("List all seasons for this server (shows active)")
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Use this command in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!canRunAdminOrAboveBot(interaction)) {
      return interaction.reply({
        content:
          "❌ You don't have permission.\n" +
          "Allowed: **Administrator** OR your highest role must be **above the bot's highest role**.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const dateTag = todayYYYYMMDD();

    // -------------------------
    // LIST
    // -------------------------
    if (sub === "list") {
      // NOTE: requires DB methods:
      // client.db.listSeasons(guildId)
      // client.db.getOrCreateSeason(guildId) OR detect active from rows
      const seasons = client.db.listSeasons(guildId) || [];

      if (seasons.length === 0) {
        return interaction.editReply("No seasons found for this server yet.");
      }

      const active = seasons.find((s) => Number(s.is_active) === 1)?.season_id ?? null;

      const lines = seasons.map((s) => {
        const mark = Number(s.is_active) === 1 ? "✅" : "•";
        const by = s.created_by ? `<@${s.created_by}>` : "—";
        return `${mark} Season **${s.season_id}** — created: ${fmtUnix(s.created_at)} — by: ${by}`;
      });

      return interaction.editReply(
        `📚 Seasons for this server:\n` +
          (active ? `Active season: **${active}**\n\n` : "\n") +
          lines.join("\n")
      );
    }

    // -------------------------
    // EXPORT (no season switch)
    // -------------------------
    if (sub === "export") {
      const seasonToExport = interaction.options.getInteger("season_id", true);

            if (!client.db.seasonExists(guildId, seasonToExport)) {
        return interaction.editReply(
          `❌ Season **${seasonToExport}** does not exist for this server.\n` +
          `Use \`/season list\` to see available seasons.`
        );
      }

      const totalsBuf = await buildSeasonTotalsCsv({
        guild,
        client,
        guildId,
        seasonId: seasonToExport,
      });

      const dailyBuf = await buildSeasonDailyCsv({
        guild,
        client,
        guildId,
        seasonId: seasonToExport,
      });

      const totalsFile = new AttachmentBuilder(totalsBuf, {
        name: `${guildId}_season_${seasonToExport}_${dateTag}_totals.csv`,
      });

      const dailyFile = new AttachmentBuilder(dailyBuf, {
        name: `${guildId}_season_${seasonToExport}_${dateTag}_daily.csv`,
      });

      return interaction.editReply({
        content:
          `📦 Season export ready.\n\n` +
          `• Exported **season ${seasonToExport}** totals + daily breakdown (attached)\n` +
          `• Active season unchanged`,
        files: [totalsFile, dailyFile],
      });
    }
    

    // -------------------------
    // START (export current then switch)
    // -------------------------
    if (sub === "start") {
      const newSeasonNumber = interaction.options.getInteger("number", true);

            if (client.db.seasonExists(guildId, newSeasonNumber)) {
        return interaction.editReply(
          `❌ Season **${newSeasonNumber}** already exists.\n` +
          `Pick a new number, or use \`/season export season_id:${newSeasonNumber}\`.`
        );
      }

      // 1) current season (active)
      const currentSeasonId = client.db.getOrCreateSeason(guildId);

      // 2) build exports BEFORE switching
      const totalsBuf = await buildSeasonTotalsCsv({
        guild,
        client,
        guildId,
        seasonId: currentSeasonId,
      });

      const dailyBuf = await buildSeasonDailyCsv({
        guild,
        client,
        guildId,
        seasonId: currentSeasonId,
      });

      const totalsFile = new AttachmentBuilder(totalsBuf, {
        name: `${guildId}_season_${currentSeasonId}_${dateTag}_totals.csv`,
      });

      const dailyFile = new AttachmentBuilder(dailyBuf, {
        name: `${guildId}_season_${currentSeasonId}_${dateTag}_daily.csv`,
      });

      // 3) switch season
      client.db.startSeason(guildId, newSeasonNumber, interaction.user.id);

      return interaction.editReply({
        content:
          `✅ Season rollover complete.\n\n` +
          `• Exported **season ${currentSeasonId}** totals + daily breakdown (attached)\n` +
          `• Activated **season ${newSeasonNumber}** for this server\n\n` +
          `From now on, requests/actions/leaderboards/charts use season ${newSeasonNumber}.`,
        files: [totalsFile, dailyFile],
      });
    }

    // Safety (should not happen)
    return interaction.editReply({
      content: "Unknown subcommand.",
    });
  },
};