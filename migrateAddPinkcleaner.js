const { DB } = require("./db");
const db = new DB();

try {
  db.db.exec(`ALTER TABLE guild_settings ADD COLUMN role_pinkcleaner_id TEXT;`);
  console.log("✅ Added role_pinkcleaner_id to guild_settings");
} catch (e) {
  // If column already exists, SQLite throws; that's fine.
  console.log("ℹ️ Migration skipped:", e.message);
}

db.close();