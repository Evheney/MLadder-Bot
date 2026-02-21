"use strict";

const {
  SlashCommandBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

// ----------
// CSV helpers (no deps)
// ----------
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(headers, rows) {
  const out = [];
  out.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    out.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return out.join("\n");
}

// ----------
// Valor formatting (optional/simple)
// Your DB stores members.valor as INTEGER.
// If you want k/m/g/t later, swap this function.
// ----------
// ----------
// Valor formatter (number -> 15G style)
// ----------
function formatValor(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "0";
  // ...use n everywhere instead of raw

  const units = [
    { value: 1e15, symbol: "P" },
    { value: 1e12, symbol: "T" },
    { value: 1e9,  symbol: "G" },
    { value: 1e6,  symbol: "M" },
    { value: 1e3,  symbol: "K" }
  ];

  for (const u of units) {
    if (raw >= u.value) {
      const num = raw / u.value;

      // Trim unnecessary decimals:
      // 15.00 -> 15
      // 1.50 -> 1.5
      // 1.234 -> 1.23
      const formatted =
        num >= 100
          ? num.toFixed(0)
          : num >= 10
            ? num.toFixed(1)
            : num.toFixed(2);

      return `${parseFloat(formatted)}${u.symbol}`;
    }
  }

  return String(raw); // below 1000
}

// ----------
// Resolve display name:
// priority: cached nickname -> global_name -> username -> Discord fetch -> userId
// ----------
async function resolveDisplayName(guild, userId, row) {
  const cached =
    (row.nickname && row.nickname.trim()) ||
    (row.global_name && row.global_name.trim()) ||
    (row.username && row.username.trim());
  if (cached) return cached;

  const inCache = guild.members.cache.get(userId);
  if (inCache) return inCache.nickname || inCache.user.globalName || inCache.user.username || userId;

  try {
    const member = await guild.members.fetch(userId);
    return member.nickname || member.user.globalName || member.user.username || userId;
  } catch {
    return userId;
  }
}

function todayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("exportdaily")
    .setDescription("Export daily activity breakdown per user (CSV).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("7 or 14 days (used for scope=window).")
        .setRequired(true)
        .addChoices(
          { name: "7", value: 7 },
          { name: "14", value: 14 }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("scope")
        .setDescription("season = whole active season, window = last N days")
        .setRequired(true)
        .addChoices(
          { name: "season", value: "season" },
          { name: "window", value: "window" }
        )
    ),

  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const guildId = guild.id;
    const days = interaction.options.getInteger("days", true);
    const scope = interaction.options.getString("scope", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Active season (your DB method returns active or creates season 1 if missing)
    // If you later want "season number" explicitly, you can query seasons table.
    const seasonId = client.db.getOrCreateSeason(guildId);

    // Pull aggregated rows
    let rows;
    try {
      if (scope === "season") {
        rows = client.db.exportDailySeason(guildId, seasonId);
      } else {
        rows = client.db.exportDailyWindow(guildId, seasonId, days);
      }
    } catch (e) {
      console.error("exportdaily query error:", e);
      return interaction.editReply(`Export failed: ${e.message}`);
    }

    // Build CSV output rows
    const out = [];
    for (const r of rows) {
      const displayName = await resolveDisplayName(guild, r.user_id, r);

      const valorRaw = Number(r.valor_raw ?? 0);
      const valorFmt = formatValor(valorRaw);

      out.push({
        day: r.day, // already YYYY-MM-DD from SQL date(...)
        display_name: displayName,
        bot_role: r.bot_role || "",
        builds: Number(r.builds ?? 0),
        hits: Number(r.hits ?? 0),
        valor_fmt: valorFmt,
        valor_raw: valorRaw,
        user_id: r.user_id,
      });

      // Optional: update member cache names if missing
      // (kept minimal: only write when cached names are empty)
      // If you want: uncomment this to keep members cache fresh.
      /*
      if (!(r.nickname || r.global_name || r.username)) {
        // best effort cache update
        try {
          const member = await guild.members.fetch(r.user_id);
          client.db.upsertMember({
            guildId,
            userId: r.user_id,
            botRole: r.bot_role || null,
            username: member.user.username ?? null,
            globalName: member.user.globalName ?? null,
            nickname: member.nickname ?? null,
          });
        } catch {}
      }
      */
    }

    const headers = [
      "day",
      "display_name",
      "bot_role",
      "builds",
      "hits",
      "valor_fmt",
      "valor_raw",
      "user_id",
    ];

    const csv = toCSV(headers, out);

    const dateTag = todayYYYYMMDD();
    const filename =
      scope === "season"
        ? `${guildId}_season_${seasonId}_${dateTag}_daily.csv`
        : `${guildId}_window_${days}_${dateTag}_daily.csv`;

    const attachment = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
      name: filename,
    });

    return interaction.editReply({
      content: `✅ Export ready: scope=${scope}, season=${seasonId}, rows=${out.length}`,
      files: [attachment],
    });
  },
};