"use strict";

const path = require("path");
const Database = require("better-sqlite3");

function now() {
  return Math.floor(Date.now() / 1000);
}

class DB {
  constructor() {
    const dbPath = path.join(__dirname, "bot.db");
    this.db = new Database(dbPath);

    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");

    // Ensure guild_settings table exists (schema bootstrap)
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
`);

    this._prepare();
  }

  _prepare() {
    // ---- Guilds / Seasons ----
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

    this.getRequestStmt = this.db.prepare(`
      SELECT * FROM requests
      WHERE guild_id=? AND season_id=? AND message_id=?
      LIMIT 1
    `);

    this.deactivateSeasonsStmt = this.db.prepare(`
      UPDATE seasons SET is_active = 0
      WHERE guild_id = ?
    `);

    this.insertSeasonStmt = this.db.prepare(`
      INSERT INTO seasons (guild_id, season_id, is_active, created_by, created_at)
      VALUES (?, ?, 1, ?, ?)
    `);

    // ---- Members (for role picker name caching) ----
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

    // ---- Guild Settings (for /setup + role IDs + channel/message IDs) ----
    this.getGuildSettingsStmt = this.db.prepare(`
      SELECT * FROM guild_settings WHERE guild_id = ? LIMIT 1
    `);

    this.upsertGuildSettingsStmt = this.db.prepare(`
      INSERT INTO guild_settings (
        guild_id, roles_channel_id, roles_message_id,
        role_builder_id, role_striker_id, role_pinkcleaner_id, role_player_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        roles_channel_id = excluded.roles_channel_id,
        roles_message_id = excluded.roles_message_id,
        role_builder_id  = excluded.role_builder_id,
        role_striker_id  = excluded.role_striker_id,
        role_pinkcleaner_id = excluded.role_pinkcleaner_id,
        role_player_id   = excluded.role_player_id,
        updated_at       = excluded.updated_at
    `);

    // ---- Requests / Actions ----
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

    this.completeRequestStmt = this.db.prepare(`
      UPDATE requests
      SET status='completed', updated_at=?
      WHERE guild_id=? AND season_id=? AND message_id=? AND status='claimed' AND claimed_by=?
    `);

    this.insertActionStmt = this.db.prepare(`
      INSERT INTO actions (guild_id, season_id, user_id, type, value, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.leaderboardStmt = this.db.prepare(`
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

    // Daily totals per user (build)
    this.dailyBuildsStmt = this.db.prepare(`
    SELECT
        user_id,
        date(datetime(created_at, 'unixepoch', '-6 hours')) AS day,
        SUM(value) AS total
    FROM actions
    WHERE guild_id=? AND season_id=? AND type='build'
        AND datetime(created_at, 'unixepoch', '-6 hours') >= datetime('now', '-6 hours', ?)
    GROUP BY user_id, day
    ORDER BY day DESC, total DESC
    `);

    // Daily totals per user (hit)
    this.dailyHitsStmt = this.db.prepare(`
    SELECT
        user_id,
        date(datetime(created_at, 'unixepoch', '-6 hours')) AS day,
        SUM(value) AS total
    FROM actions
    WHERE guild_id=? AND season_id=? AND type='hit'
        AND datetime(created_at, 'unixepoch', '-6 hours') >= datetime('now', '-6 hours', ?)
    GROUP BY user_id, day
    ORDER BY day DESC, total DESC
    `);

    this.dailyTotalsStmt = this.db.prepare(`
    SELECT
        date(datetime(created_at, 'unixepoch', '-6 hours')) AS day,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
    FROM actions
    WHERE guild_id=? AND season_id=?
        AND datetime(created_at, 'unixepoch', '-6 hours') >= datetime('now', '-6 hours', ?)
    GROUP BY day
    ORDER BY day DESC
    `);

    this.userDailyTotalsStmt = this.db.prepare(`
    SELECT
        date(datetime(created_at, 'unixepoch', '-6 hours')) AS day,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
    FROM actions
    WHERE guild_id=? AND season_id=? AND user_id=?
        AND datetime(created_at, 'unixepoch', '-6 hours') >= datetime('now', '-6 hours', '-2 days')
    GROUP BY day
    ORDER BY day DESC
    `);

    this.activityAllStmt = this.db.prepare(`
    WITH agg AS (
        SELECT
        user_id,
        date(datetime(created_at, 'unixepoch', '-6 hours')) AS day,
        SUM(CASE WHEN type='build' THEN value ELSE 0 END) AS builds,
        SUM(CASE WHEN type='hit' THEN value ELSE 0 END) AS hits
        FROM actions
        WHERE guild_id=? AND season_id=?
        AND datetime(created_at, 'unixepoch', '-6 hours') >= datetime('now', '-6 hours', '-1 day')
        GROUP BY user_id, day
    ),
    days AS (
        SELECT
        date(datetime('now', '-6 hours')) AS today,
        date(datetime('now', '-6 hours', '-1 day')) AS yesterday
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
  }

  // -----------------
  // Guild / Season
  // -----------------
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

  // -----------------
  // Members (used by role picker)
  // -----------------
  upsertMember({
    guildId,
    userId,
    botRole = null,
    username = null,
    globalName = null,
    nickname = null,
  }) {
    const t = now();
    const nameUpdatedAt = (username || globalName || nickname) ? t : null;

    this.ensureGuild(guildId);

    // Ensure row exists with valor=0
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

    // Update metadata/role (does NOT touch valor)
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

  // -----------------
  // Guild Settings (/setup)
  // -----------------
  getGuildSettings(guildId) {
    return this.getGuildSettingsStmt.get(guildId) || null;
  }

  saveGuildSettings(data) {
  // Accept BOTH snake_case (preferred) and camelCase (old)
  const guildId = data.guild_id ?? data.guildId;
  const rolesChannelId = data.roles_channel_id ?? data.rolesChannelId;
  const rolesMessageId = data.roles_message_id ?? data.rolesMessageId;

  const roleBuilderId = data.role_builder_id ?? data.roleBuilderId;
  const roleStrikerId = data.role_striker_id ?? data.roleStrikerId;
  const rolePinkcleanerId = data.role_pinkcleaner_id ?? data.rolePinkcleanerId;
  const rolePlayerId = data.role_player_id ?? data.rolePlayerId;

  if (!guildId) throw new Error("saveGuildSettings: missing guild_id/guildId");

  this.ensureGuild(guildId);

  this.upsertGuildSettingsStmt.run(
    guildId,
    rolesChannelId || null,
    rolesMessageId || null,
    roleBuilderId || null,
    roleStrikerId || null,
    rolePinkcleanerId || null,
    rolePlayerId || null,
    now()
  );
}

  // -----------------
  // Requests / Actions
  // -----------------
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

  completeRequest({ guildId, seasonId, messageId, builderId, levels }) {
    const tx = this.db.transaction(() => {
     const res = this.completeRequestStmt.run(
        now(),
        guildId,
        seasonId,
        messageId,
        builderId
    );

      if (res.changes !== 1) return false;

      for (const lvl of levels) {
        this.insertActionStmt.run(
          guildId,
          seasonId,
          builderId,
          "hit",
          1,
          JSON.stringify({ level: lvl, messageId }),
          now()
        );
      }

      this.insertActionStmt.run(
        guildId,
        seasonId,
        builderId,
        "build",
        levels.length, // ✅ builds = number requested
        JSON.stringify({ messageId, levels }),
        now()
      );

      return true;
    });

    return tx();
  }

  getRequest({ guildId, seasonId, messageId }) {
  return this.getRequestStmt.get(guildId, seasonId, messageId) || null;
  }

  getLeaderboard(guildId, seasonId, limit = 10) {
    return this.leaderboardStmt.all(guildId, seasonId, limit);
  }

  getBuildLeaderboard(guildId, seasonId, limit = 10) {
  return this.buildLeaderboardStmt.all(guildId, seasonId, limit);
  }

  getHitLeaderboard(guildId, seasonId, limit = 10) {
  return this.leaderboardStmt.all(guildId, seasonId, limit);
  }

  getDailyBuilds(guildId, seasonId, days = 7) {
  // days back including today
  const since = `-${days} days`;
  return this.dailyBuildsStmt.all(guildId, seasonId, since);
}

getDailyHits(guildId, seasonId, days = 7) {
  const since = `-${days} days`;
  return this.dailyHitsStmt.all(guildId, seasonId, since);
}

getDailyTotals(guildId, seasonId, days = 7) {
  const since = `-${days} days`;
  return this.dailyTotalsStmt.all(guildId, seasonId, since);
}

getUserDailyTotals(guildId, seasonId, userId) {
  return this.userDailyTotalsStmt.all(guildId, seasonId, userId);
}

getActivityAll(guildId, seasonId) {
  return this.activityAllStmt.all(guildId, seasonId);
}

  close() {
    this.db.close();
  }
}

module.exports = { DB };