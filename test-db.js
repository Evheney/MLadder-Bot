const { DB } = require("./db");

const db = new DB();

const guildId = "guild1";
const messageId = `msg_${Date.now()}`;

const seasonId = db.getOrCreateSeason(guildId);
console.log("Season:", seasonId);
console.log("MessageId:", messageId);

// Show tables
const tables = db.db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map(r => r.name);
console.log("Tables:", tables);

// DEV ONLY: wipe test guild data so leaderboard starts from 0
//db.db.prepare("DELETE FROM actions WHERE guild_id=?").run(guildId);
//db.db.prepare("DELETE FROM requests WHERE guild_id=?").run(guildId);

// Create
db.createRequest({
  guildId,
  seasonId,
  messageId,
  requesterId: "userA",
  levels: [1],
});

// Verify status open
let req = db.db
  .prepare("SELECT status, claimed_by, levels_json FROM requests WHERE guild_id=? AND season_id=? AND message_id=?")
  .get(guildId, seasonId, messageId);
console.log("After create:", req);

// Claim by builder1
const claimed1 = db.claimRequest({
  guildId,
  seasonId,
  messageId,
  builderId: "builder1",
});
console.log("Claimed by builder1:", claimed1);

// Try claim again by builder2 (should be false)
const claimed2 = db.claimRequest({
  guildId,
  seasonId,
  messageId,
  builderId: "builder2",
});
console.log("Claimed by builder2 (should be false):", claimed2);

// Verify status claimed + claimed_by builder1
req = db.db
  .prepare("SELECT status, claimed_by FROM requests WHERE guild_id=? AND season_id=? AND message_id=?")
  .get(guildId, seasonId, messageId);
console.log("After claim:", req);

// Complete by WRONG builder2 (should be false IF your SQL verifies claimed_by)
const completedWrong = db.completeRequest({
  guildId,
  seasonId,
  messageId,
  builderId: "builder2",
  levels: [1],
});
console.log("Completed by builder2 (should be false):", completedWrong);

// Complete by correct builder1 (should be true)
const completedRight = db.completeRequest({
  guildId,
  seasonId,
  messageId,
  builderId: "builder1",
  levels: [1],
});
console.log("Completed by builder1:", completedRight);

// Try complete again (should be false)
const completedAgain = db.completeRequest({
  guildId,
  seasonId,
  messageId,
  builderId: "builder1",
  levels: [1],
});
console.log("Completed again (should be false):", completedAgain);

// Verify final request status
req = db.db
  .prepare("SELECT status, claimed_by FROM requests WHERE guild_id=? AND season_id=? AND message_id=?")
  .get(guildId, seasonId, messageId);
console.log("After complete:", req);

// Verify actions counts (should be: hits=3 rows + build=1 row)
const actionCounts = db.db.prepare(`
  SELECT type, COUNT(*) AS cnt, SUM(value) AS total
  FROM actions
  WHERE guild_id=? AND season_id=?
  GROUP BY type
`).all(guildId, seasonId);
console.log("Action counts:", actionCounts);

// Leaderboard (hit)
console.log("Leaderboard:", db.getLeaderboard(guildId, seasonId, 10));
console.log("Build Leaderboard:", db.getBuildLeaderboard(guildId, seasonId));
console.log("Hit Leaderboard:", db.getLeaderboard(guildId, seasonId));


db.close();