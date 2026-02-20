const { DB } = require("./db");

const db = new DB();

const rows = db.db.prepare(`
  SELECT type, COUNT(*) as rows, SUM(value) as total
  FROM actions
  GROUP BY type
`).all();

console.log(rows);

db.close();