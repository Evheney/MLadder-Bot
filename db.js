"use strict";

const path = require("path");
const Database = require("better-sqlite3");

// -----------------
// Helpers
// -----------------
function now() {
  return Math.floor(Date.now() / 1000);
}

function toOffsetExprMinutes(mins) {
  // SQLite datetime modifier string, e.g. "-360 minutes", "180 minutes"
  const m = Number(mins);
  if (!Number.isFinite(m)) return "-360 minutes";
  return `${m} minutes`;
}

class DB {
  constructor() {
    const dbPath = path.join(__dirname, "bot.db");
    this.db = new Database(dbPath);

    // -----------------
    // SQLite pragmas
    // -----------------
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");

    // -----------------
    // Schema bootstrap
    // -----------------
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guilds (
        guild_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS seasons (
        guild_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, season_id)
      );

      CREATE TABLE IF NOT EXISTS members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        bot_role TEXT,
        valor INTEGER NOT NULL DEFAULT 0,
        username TEXT,
        global_name TEXT,
        nickname TEXT,
        name_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS requests (
        guild_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        levels_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        claimed_by TEXT,
        meta_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, season_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value INTEGER NOT NULL,
        meta_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        roles_channel_id TEXT,
        roles_message_id TEXT,
        role_builder_id TEXT,
        role_striker_id TEXT,
        role_pinkcleaner_id TEXT,
        role_player_id TEXT,
        timezone_offset_minutes INTEGER NOT NULL DEFAULT -360,
        updated_at INTEGER NOT NULL
      );
    `);

    // -----------------
    // Migrations (safe)
    // -----------------
    try {
      this.db.exec(`ALTER TABLE requests ADD COLUMN meta_json TEXT`);
    } catch (_) {
      // already exists
    }

    try {
      this.db.exec(`
        ALTER TABLE guild_settings
        ADD COLUMN timezone_offset_minutes INTEGER NOT NULL DEFAULT -360
      `);
    } catch (_) {
      // already exists
    }

    this._prepare();
    
    // -----------------
    // Action batching (write-behind)
    // -----------------
    this.initActionBuffer({ flushIntervalMs: 60_000, maxQueue: 400 });
  }

  // -----------------
  // Prepared statements
  // -----------------
  _prepare() {
    // =========================================================
    // GUILDS + SEASONS
    // =========================================================
    this.ensureGuildStmt = this.db.prepare(`
      INSERT INTO guilds (guild_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO NOTHING
    `);

    this.getActiveSeasonStmt = this.db.prepare(`
      SELECT season_id FROM seasons
      WHERE guild_id = ? AND is_active = 1
      LIMIT 1
    `);

    this.seasonExistsStmt = this.db.prepare(`
      SELECT 1
      FROM seasons
      WHERE guild_id=? AND season_id=?
      LIMIT 1
    `);

    this.listSeasonsStmt = this.db.prepare(`
      SELECT season_id, is_active, created_by, created_at
      FROM seasons
      WHERE guild_id=?
      ORDER BY season_id DESC
    `);

    this.deactivateSeasonsStmt = this.db.prepare(`
      UPDATE seasons SET is_active = 0
      WHERE guild_id = ?
    `);

    this.insertSeasonStmt = this.db.prepare(`
      INSERT INTO seasons (guild_id, season_id, is_active, created_by, created_at)
      VALUES (?, ?, 1, ?, ?)
    `);

    this.upsertSeasonStmt = this.db.prepare(`
      INSERT INTO seasons (guild_id, season_id, is_active, created_by, created_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(guild_id, season_id) DO UPDATE SET
        is_active = 1
    `);

    // =========================================================
    // GUILD SETTINGS (setup + roles + timezone)
    // =========================================================
    this.getGuildSettingsStmt = this.db.prepare(`
      SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1
    `);

    this.upsertGuildSettingsStmt = this.db.prepare(`
      INSERT INTO guild_settings (
        guild_id, roles_channel_id, roles_message_id,
        role_builder_id, role_striker_id, role_pinkcleaner_id, role_player_id,
        timezone_offset_minutes,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        roles_channel_id = excluded.roles_channel_id,
        roles_message_id = excluded.roles_message_id,
        role_builder_id  = excluded.role_builder_id,
        role_striker_id  = excluded.role_striker_id,
        role_pinkcleaner_id = excluded.role_pinkcleaner_id,
        role_player_id   = excluded.role_player_id,
        timezone_offset_minutes = excluded.timezone_offset_minutes,
        updated_at       = excluded.updated_at
    `);

    // =========================================================
    // MEMBERS (role picker name caching + valor)
    // =========================================================
    this.insertMemberIfMissingStmt = this.db.prepare(`
      INSERT INTO members (
        guild_id, user_id, bot_role, valor,
        username, global_name, nickname, name_updated_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO NOTHING
    `);

    this.updateMemberMetaStmt = this.db.prepare(`
      UPDATE members SET
        bot_role = COALESCE(?, bot_role),
        username = COALESCE(?, username),
        global_name = COALESCE(?, global_name),
        nickname = COALESCE(?, nickname),
        name_updated_at = COALESCE(?, name_updated_at),
        updated_at = ?
      WHERE guild_id = ? AND user_id = ?
    `);

    this.getMemberValorStmt = this.db.prepare(`
      SELECT valor FROM members WHERE guild_id=? AND user_id=? LIMIT 1
    `);

    this.getMemberNamesStmt = this.db.prepare(`
      SELECT nickname, global_name, username, bot_role, valor
      FROM members
      WHERE guild_id=? AND user_id=?
      LIMIT 1
    `);
    this.getMembersMetaByIdsStmt = this.db.prepare(`
      SELECT user_id, bot_role, valor, username, global_name, nickname
      FROM members
      WHERE guild_id = ? AND user_id IN (
        SELECT value FROM json_each(?)
      )
    `);

    // =========================================================
    // REQUESTS (request lifecycle + buttons)
    // =========================================================
    this.getRequestStmt = this.db.prepare(`
      SELECT * FROM requests
      WHERE guild_id=? AND season_id=? AND message_id=?
      LIMIT 1
    `);

    this.insertRequestStmt = this.db.prepare(`
      INSERT INTO requests (
        guild_id, season_id, message_id, requester_id,
        levels_json, status, claimed_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?)
    `);

    this.claimRequestStmt = this.db.prepare(`
      UPDATE requests
      SET status='claimed', claimed_by=?, updated_at=?
      WHERE guild_id=? AND season_id=? AND message_id=? AND status='open'
    `);

    this.stmtSetRequestMeta = this.db.prepare(`
      UPDATE requests
      SET meta_json = ?, updated_at = ?
      WHERE guild_id = ? AND season_id = ? AND message_id = ?
    `);

    // requires same builder to complete
    this.completeRequestStmt = this.db.prepare(`
      UPDATE requests
      SET status='completed', updated_at=?
      WHERE guild_id=? AND season_id=? AND message_id=? AND status='claimed' AND claimed_by=?
    `);

    this.cancelRequestStmt = this.db.prepare(`
      UPDATE requests
      SET status='cancelled', meta_json=?, updated_at=?
      WHERE guild_id=? AND season_id=? AND message_id=?
        AND status IN ('open','claimed')
    `);

    // =========================================================
    // ACTIONS (writes + leaderboards)
    // =========================================================
    this.insertActionStmt = this.db.prepare(`
      INSERT INTO actions (guild_id, season_id, user_id, type, value, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.hitLeaderboardStmt = this.db.prepare(`
      SELECT user_id, SUM(value) as total
      FROM actions
      WHERE guild_id=? AND season_id=? AND type='hit'
      GROUP BY user_id
      ORDER BY total DESC
      LIMIT ?
    `);

    this.buildLeaderboardStmt = this.db.prepare(`
      SELECT user_id, SUM(value) as total
      FROM actions
      WHERE guild_id=? AND season_id=? AND type='build'
      GROUP BY user_id
      ORDER BY total DESC
      LIMIT ?
    `);

    // =========================================================
    // ACTIVITY / DAILY AGGREGATIONS (timezone-aware)
    // Uses offsetExpr like "-360 minutes"
    // Uses sinceExpr like "-7 days"
    // =========================================================

    // Daily totals per user (build)
    // params: offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.dailyBuildsStmt = this.db.prepare(`
      SELECT
        user_id,
        date(datetime(created_at, 'unixepoch', ?)) AS day,
        SUM(value) AS total
      FROM actions
      WHERE guild_id=? AND season_id=? AND type='build'
        AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
      GROUP BY user_id, day
      ORDER BY day DESC, total DESC
    `);

    // Daily totals per user (hit)
    // params: offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.dailyHitsStmt = this.db.prepare(`
      SELECT
        user_id,
        date(datetime(created_at, 'unixepoch', ?)) AS day,
        SUM(value) AS total
      FROM actions
      WHERE guild_id=? AND season_id=? AND type='hit'
        AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
      GROUP BY user_id, day
      ORDER BY day DESC, total DESC
    `);

    // Server totals per day
    // params: offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.dailyTotalsStmt = this.db.prepare(`
      SELECT
        date(datetime(created_at, 'unixepoch', ?)) AS day,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
      FROM actions
      WHERE guild_id=? AND season_id=?
        AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
      GROUP BY day
      ORDER BY day DESC
    `);

    // =========================================================
    // SERVER DAILY SERIES (for /chartserver) includes zero days
    // =========================================================
    // params:
    // offsetExpr, startDayOffset, offsetExpr, offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.serverDailySeriesForChartStmt = this.db.prepare(`
      WITH RECURSIVE days(day) AS (
        SELECT date(datetime('now', ?, ?))
        UNION ALL
        SELECT date(day, '+1 day') FROM days
        WHERE day < date(datetime('now', ?))
      ),
      agg AS (
        SELECT
          date(datetime(created_at, 'unixepoch', ?)) AS day,
          SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
          SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
        FROM actions
        WHERE guild_id=? AND season_id=?
          AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
        GROUP BY day
      )
      SELECT
        days.day AS day,
        COALESCE(agg.builds, 0) AS builds,
        COALESCE(agg.hits, 0) AS hits
      FROM days
      LEFT JOIN agg ON agg.day = days.day
      ORDER BY days.day ASC
    `);

    // =========================================================
    // USER TOTALS (season + window) / activity comparisons
    // =========================================================
    this.userTotalsSeasonStmt = this.db.prepare(`
      SELECT
        user_id,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
      FROM actions
      WHERE guild_id=? AND season_id=?
      GROUP BY user_id
    `);

    // params: guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.userTotalsWindowStmt = this.db.prepare(`
      SELECT
        user_id,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
      FROM actions
      WHERE guild_id=? AND season_id=?
        AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
      GROUP BY user_id
    `);

    // params: offsetExpr, guildId, seasonId, userId, offsetExpr, offsetExpr
    this.userDailyTotalsStmt = this.db.prepare(`
      SELECT
        date(datetime(created_at, 'unixepoch', ?)) AS day,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
      FROM actions
      WHERE guild_id=? AND season_id=? AND user_id=?
        AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, '-2 days')
      GROUP BY day
      ORDER BY day DESC
    `);

    // params: offsetExpr, offsetExpr, guildId, seasonId, offsetExpr, offsetExpr
    this.activityAllStmt = this.db.prepare(`
      WITH agg AS (
        SELECT
          user_id,
          date(datetime(created_at, 'unixepoch', ?)) AS day,
          SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
          SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
        FROM actions
        WHERE guild_id=? AND season_id=?
          AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, '-1 day')
        GROUP BY user_id, day
      ),
      days AS (
        SELECT
          date(datetime('now', ?)) AS today,
          date(datetime('now', ?, '-1 day')) AS yesterday
      )
      SELECT
        a.user_id,
        COALESCE(SUM(CASE WHEN a.day = days.today THEN a.builds END), 0) AS today_builds,
        COALESCE(SUM(CASE WHEN a.day = days.yesterday THEN a.builds END), 0) AS yesterday_builds,
        COALESCE(SUM(CASE WHEN a.day = days.today THEN a.hits END), 0) AS today_hits,
        COALESCE(SUM(CASE WHEN a.day = days.yesterday THEN a.hits END), 0) AS yesterday_hits
      FROM agg a, days
      GROUP BY a.user_id
    `);

    // params:
    // offsetExpr, startDayOffset, offsetExpr, offsetExpr, guildId, seasonId, userId, offsetExpr, offsetExpr, sinceExpr
    this.userDailySeriesStmt = this.db.prepare(`
      WITH RECURSIVE days(day) AS (
        SELECT date(datetime('now', ?, ?))
        UNION ALL
        SELECT date(day, '+1 day') FROM days
        WHERE day < date(datetime('now', ?))
      ),
      agg AS (
        SELECT
          date(datetime(created_at, 'unixepoch', ?)) AS day,
          SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
          SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
        FROM actions
        WHERE guild_id=? AND season_id=? AND user_id=?
          AND datetime(created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
        GROUP BY day
      )
      SELECT
        days.day AS day,
        COALESCE(agg.builds, 0) AS builds,
        COALESCE(agg.hits, 0) AS hits
      FROM days
      LEFT JOIN agg ON agg.day = days.day
      ORDER BY days.day ASC
    `);

    // =========================================================
    // EXPORTDAILY (per user per day, timezone-aware) + member cache join
    // =========================================================

    // scope=season
    // params: offsetExpr, guildId, seasonId
    this.exportDailySeasonStmt = this.db.prepare(`
      SELECT
        date(datetime(a.created_at, 'unixepoch', ?)) AS day,
        a.user_id AS user_id,

        COALESCE(m.bot_role, '') AS bot_role,
        COALESCE(m.nickname, '') AS nickname,
        COALESCE(m.global_name, '') AS global_name,
        COALESCE(m.username, '') AS username,

        SUM(CASE WHEN a.type='build' THEN a.value ELSE 0 END) AS builds,
        SUM(CASE WHEN a.type='hit' THEN a.value ELSE 0 END) AS hits,

        COALESCE(m.valor, 0) AS valor_raw
      FROM actions a
      LEFT JOIN members m
        ON m.guild_id = a.guild_id AND m.user_id = a.user_id
      WHERE a.guild_id = ? AND a.season_id = ?
      GROUP BY day, a.user_id
      ORDER BY day ASC, builds DESC, hits DESC
    `);

    // scope=window
    // params: offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, sinceExpr
    this.exportDailyWindowStmt = this.db.prepare(`
      SELECT
        date(datetime(a.created_at, 'unixepoch', ?)) AS day,
        a.user_id AS user_id,

        COALESCE(m.bot_role, '') AS bot_role,
        COALESCE(m.nickname, '') AS nickname,
        COALESCE(m.global_name, '') AS global_name,
        COALESCE(m.username, '') AS username,

        SUM(CASE WHEN a.type='build' THEN a.value ELSE 0 END) AS builds,
        SUM(CASE WHEN a.type='hit' THEN a.value ELSE 0 END) AS hits,

        COALESCE(m.valor, 0) AS valor_raw
      FROM actions a
      LEFT JOIN members m
        ON m.guild_id = a.guild_id AND m.user_id = a.user_id
      WHERE a.guild_id = ? AND a.season_id = ?
        AND datetime(a.created_at, 'unixepoch', ?) >= datetime('now', ?, ?)
      GROUP BY day, a.user_id
      ORDER BY day ASC, builds DESC, hits DESC
    `);
  }

  // =========================================================
  // GUILDS / SEASONS
  // =========================================================
  ensureGuild(guildId) {
    this.ensureGuildStmt.run(guildId, now());
  }

  getOrCreateSeason(guildId) {
    this.ensureGuild(guildId);

    const row = this.getActiveSeasonStmt.get(guildId);
    if (row) return row.season_id;

    this.deactivateSeasonsStmt.run(guildId);
    this.insertSeasonStmt.run(guildId, 1, null, now());
    return 1;
  }
  seasonExists(guildId, seasonId) {
    const row = this.seasonExistsStmt.get(guildId, seasonId);
    return !!row;
  }

  listSeasons(guildId) {
    this.ensureGuild(guildId);
    return this.listSeasonsStmt.all(guildId);
  }

  startSeason(guildId, seasonId, createdBy = null) {
    this.ensureGuild(guildId);
    const t = now();

    const tx = this.db.transaction(() => {
      this.deactivateSeasonsStmt.run(guildId);
      this.upsertSeasonStmt.run(guildId, seasonId, createdBy, t);
    });

    tx();
    return seasonId;
  }

  // =========================================================
  // GUILD SETTINGS
  // =========================================================
  getGuildSettings(guildId) {
    return this.getGuildSettingsStmt.get(guildId) || null;
  }

  getTimezoneOffsetMinutes(guildId) {
    const row = this.getGuildSettings(guildId);
    return row?.timezone_offset_minutes ?? -360;
  }

  getOffsetExpr(guildId) {
    return toOffsetExprMinutes(this.getTimezoneOffsetMinutes(guildId));
  }

  saveGuildSettings(data) {
    // Accept BOTH snake_case and camelCase
    const guildId = data.guild_id ?? data.guildId;

    const rolesChannelId = data.roles_channel_id ?? data.rolesChannelId;
    const rolesMessageId = data.roles_message_id ?? data.rolesMessageId;

    const roleBuilderId = data.role_builder_id ?? data.roleBuilderId;
    const roleStrikerId = data.role_striker_id ?? data.roleStrikerId;
    const rolePinkcleanerId = data.role_pinkcleaner_id ?? data.rolePinkcleanerId;
    const rolePlayerId = data.role_player_id ?? data.rolePlayerId;

    const tzIncoming =
      data.timezone_offset_minutes ??
      data.timezoneOffsetMinutes ??
      data.tz_offset_minutes ??
      data.tzOffsetMinutes;

    if (!guildId) throw new Error("saveGuildSettings: missing guild_id/guildId");

    this.ensureGuild(guildId);

    // Preserve existing timezone if not provided
    const existing = this.getGuildSettings(guildId);
    const tz =
      typeof tzIncoming === "number"
        ? tzIncoming
        : existing?.timezone_offset_minutes ?? -360;

    this.upsertGuildSettingsStmt.run(
      guildId,
      rolesChannelId ?? existing?.roles_channel_id ?? null,
      rolesMessageId ?? existing?.roles_message_id ?? null,
      roleBuilderId ?? existing?.role_builder_id ?? null,
      roleStrikerId ?? existing?.role_striker_id ?? null,
      rolePinkcleanerId ?? existing?.role_pinkcleaner_id ?? null,
      rolePlayerId ?? existing?.role_player_id ?? null,
      tz,
      now()
    );
  }

  // =========================================================
  // MEMBERS
  // =========================================================
  upsertMember({
    guildId,
    userId,
    botRole = null,
    username = null,
    globalName = null,
    nickname = null,
  }) {
    const t = now();
    const nameUpdatedAt = username || globalName || nickname ? t : null;

    this.ensureGuild(guildId);

    this.insertMemberIfMissingStmt.run(
      guildId,
      userId,
      botRole,
      username,
      globalName,
      nickname,
      nameUpdatedAt,
      t,
      t
    );

    this.updateMemberMetaStmt.run(
      botRole,
      username,
      globalName,
      nickname,
      nameUpdatedAt,
      t,
      guildId,
      userId
    );
  }

  getMemberValor(guildId, userId) {
    const row = this.getMemberValorStmt.get(guildId, userId);
    return row?.valor ?? 0;
  }

  getMemberNames(guildId, userId) {
    return this.getMemberNamesStmt.get(guildId, userId) || null;
  }

  getMembersMetaByIds(guildId, userIds) {
  const arr = Array.isArray(userIds) ? userIds : [];
  return this.getMembersMetaByIdsStmt.all(guildId, JSON.stringify(arr));
  }

  // =========================================================
  // REQUESTS / ACTIONS
  // =========================================================
  createRequest({ guildId, seasonId, messageId, requesterId, levels }) {
    this.insertRequestStmt.run(
      guildId,
      seasonId,
      messageId,
      requesterId,
      JSON.stringify(levels),
      now(),
      now()
    );
  }

  getRequest({ guildId, seasonId, messageId }) {
    return this.getRequestStmt.get(guildId, seasonId, messageId) || null;
  }

  claimRequest({ guildId, seasonId, messageId, builderId }) {
    const result = this.claimRequestStmt.run(
      builderId,
      now(),
      guildId,
      seasonId,
      messageId
    );
    return result.changes === 1;
  }
  setRequestMeta({ guildId, seasonId, messageId, metaJson }) {
    const ts = now();
    const res = this.stmtSetRequestMeta.run(metaJson, ts, guildId, seasonId, messageId);
    return res.changes > 0;
  }

  completeRequest({ guildId, seasonId, messageId, builderId, levels }) {
  const t = now();

  // Do the request status transition atomically (MUST be immediate)
  const tx = this.db.transaction(() => {
    const res = this.completeRequestStmt.run(
      t,
      guildId,
      seasonId,
      messageId,
      builderId
    );

    if (res.changes !== 1) return null;

    // Build action rows to enqueue (NOT written to DB here)
    const actionsToQueue = [];

    // hits: 1 per level (keeps your max-hit logic intact)
    for (const lvl of levels) {
      actionsToQueue.push({
        guild_id: guildId,
        season_id: seasonId,
        user_id: builderId,
        type: "hit",
        value: 1,
        meta_json: JSON.stringify({ level: lvl, messageId }),
        created_at: t,
      });
    }

    // builds: value = number requested (levels.length)
    actionsToQueue.push({
      guild_id: guildId,
      season_id: seasonId,
      user_id: builderId,
      type: "build",
      value: levels.length,
      meta_json: JSON.stringify({ messageId, levels }),
      created_at: t,
    });

    return actionsToQueue;
  });

  const actions = tx();
  if (!actions) return false;

  // Enqueue outside the transaction to avoid nested transactions / delays
  for (const a of actions) this.enqueueAction(a);

  return true;
}

  cancelRequest({ guildId, seasonId, messageId, cancelledBy }) {
    const meta = JSON.stringify({ cancelledBy });
    const res = this.cancelRequestStmt.run(meta, now(), guildId, seasonId, messageId);
    return res.changes === 1;
  }

  // =========================================================
  // LEADERBOARDS
  // =========================================================
  getHitLeaderboard(guildId, seasonId, limit = 10) {
    return this.hitLeaderboardStmt.all(guildId, seasonId, limit);
  }

  getBuildLeaderboard(guildId, seasonId, limit = 10) {
    return this.buildLeaderboardStmt.all(guildId, seasonId, limit);
  }

  // =========================================================
  // ACTIVITY / CHART QUERIES
  // =========================================================
  getDailyBuilds(guildId, seasonId, days = 7) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const since = `-${days} days`;
    return this.dailyBuildsStmt.all(offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, since);
  }

  getDailyHits(guildId, seasonId, days = 7) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const since = `-${days} days`;
    return this.dailyHitsStmt.all(offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, since);
  }

  getDailyTotals(guildId, seasonId, days = 7) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const since = `-${days} days`;
    return this.dailyTotalsStmt.all(offsetExpr, guildId, seasonId, offsetExpr, offsetExpr, since);
  }

  getUserDailyTotals(guildId, seasonId, userId) {
    const offsetExpr = this.getOffsetExpr(guildId);
    return this.userDailyTotalsStmt.all(offsetExpr, guildId, seasonId, userId, offsetExpr, offsetExpr);
  }

  getActivityAll(guildId, seasonId) {
    const offsetExpr = this.getOffsetExpr(guildId);
    return this.activityAllStmt.all(
      offsetExpr, // agg day bucketing
      offsetExpr, // created_at compare (used in WHERE)
      guildId,
      seasonId,
      offsetExpr, // now offset in compare
      offsetExpr, // days.today
      offsetExpr  // days.yesterday
    );
  }

  getUserDailySeries(guildId, seasonId, userId, days = 14) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const startDayOffset = `-${days - 1} days`; // include today
    const since = `-${days} days`;
    return this.userDailySeriesStmt.all(
      offsetExpr,
      startDayOffset,
      offsetExpr,
      offsetExpr,
      guildId,
      seasonId,
      userId,
      offsetExpr,
      offsetExpr,
      since
    );
  }

  getServerDailySeries(guildId, seasonId, days = 14) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const startDayOffset = `-${days - 1} days`;
    const since = `-${days} days`;

    return this.serverDailySeriesForChartStmt.all(
      offsetExpr,
      startDayOffset,
      offsetExpr,
      offsetExpr,
      guildId,
      seasonId,
      offsetExpr,
      offsetExpr,
      since
    );
  }

  getUserTotalsSeason(guildId, seasonId) {
    return this.userTotalsSeasonStmt.all(guildId, seasonId);
  }

  getUserTotalsWindow(guildId, seasonId, days = 14) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const since = `-${days} days`;
    return this.userTotalsWindowStmt.all(guildId, seasonId, offsetExpr, offsetExpr, since);
  }

  // =========================================================
  // EXPORTDAILY
  // =========================================================
  exportDailySeason(guildId, seasonId) {
    const offsetExpr = this.getOffsetExpr(guildId);
    return this.exportDailySeasonStmt.all(offsetExpr, guildId, seasonId);
  }

  exportDailyWindow(guildId, seasonId, days = 7) {
    const offsetExpr = this.getOffsetExpr(guildId);
    const since = `-${days} days`;
    return this.exportDailyWindowStmt.all(
      offsetExpr, // day bucketing
      guildId,
      seasonId,
      offsetExpr, // created_at compare
      offsetExpr, // now offset
      since
    );
  }

    // =========================================================
  // Action batching (write-behind buffer)
  // - Buffers INSERTs into actions table
  // - Flushes every N ms or when queue hits maxQueue
  // =========================================================
  initActionBuffer({ flushIntervalMs = 60_000, maxQueue = 400 } = {}) {
    this._actionQueue = [];
    this._actionFlushIntervalMs = flushIntervalMs;
    this._actionMaxQueue = maxQueue;

    if (this._actionFlushTimer) clearInterval(this._actionFlushTimer);

    this._actionFlushTimer = setInterval(() => {
      try {
        this.flushActionQueue();
      } catch (e) {
        console.error("flushActionQueue error:", e);
      }
    }, this._actionFlushIntervalMs);

    // Don't keep the process alive because of this interval
    if (typeof this._actionFlushTimer.unref === "function") {
      this._actionFlushTimer.unref();
    }
  }

  enqueueAction(actionRow) {
    // actionRow shape:
    // { guild_id, season_id, user_id, type, value, meta_json, created_at }
    if (!this._actionQueue) this._actionQueue = [];
    this._actionQueue.push(actionRow);

    if (this._actionQueue.length >= (this._actionMaxQueue || 400)) {
      this.flushActionQueue();
    }
  }

  flushActionQueue() {
    if (!this._actionQueue || this._actionQueue.length === 0) return 0;

    const batch = this._actionQueue;
    this._actionQueue = [];

    const tx = this.db.transaction(() => {
      for (const a of batch) {
        this.insertActionStmt.run(
          a.guild_id,
          a.season_id,
          a.user_id,
          a.type,
          a.value,
          a.meta_json ?? null,
          a.created_at
        );
      }
    });

    tx();
    return batch.length;
  }

  // =========================================================
  // Close
  // =========================================================
    close() {
    try { this.flushActionQueue(); } catch (_) {}
    try { if (this._actionFlushTimer) clearInterval(this._actionFlushTimer); } catch (_) {}
    this.db.close();
  }
}

module.exports = { DB };