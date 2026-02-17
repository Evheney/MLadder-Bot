const fs = require("fs");
const path = require("path");

function parseValue(raw) {
  if (raw === undefined || raw === null) return 0;
  let s = String(raw).trim();
  if (!s || s.toLowerCase() === "n/a") return 0;

  // allow commas/spaces in numbers
  s = s.replace(/,/g, "").replace(/\s+/g, "");

  // plain integer/float
  const m = s.match(/^(\d+(\.\d+)?)([KMGTP])?$/i);
  if (!m) {
    throw new Error(`Bad value: "${raw}" (expected number or suffix K/M/G/T/P or N/A)`);
  }

  const num = Number(m[1]);
  const suf = (m[3] || "").toUpperCase();

  const mult = suf === "K" ? 1e3 :
               suf === "M" ? 1e6 :
               suf === "G" ? 1e9 :
               suf === "T" ? 1e12 :
               suf === "P" ? 1e15 : 1;

  // store as integer
  return Math.round(num * mult);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows.");

  const header = lines[0].trim();
  if (header !== "level,wall,upgradeCost") {
    throw new Error(`CSV header must be exactly: level,wall,upgradeCost (got: ${header})`);
  }

  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) throw new Error(`Row ${i + 1} has <3 columns: ${lines[i]}`);

    const level = Number(parts[0].trim());
    if (!Number.isInteger(level) || level < 1) throw new Error(`Bad level on row ${i + 1}: "${parts[0]}"`);

    const wall = parseValue(parts[1]);
    const upgradeCost = parseValue(parts[2]);

    out[String(level)] = { level, wall, upgradeCost };
  }
  return out;
}

const inputPath = path.join(__dirname, "..", "tables", "cityTable_template.csv");
const outputPath = path.join(__dirname, "..", "tables", "cityTable.json");

const csv = fs.readFileSync(inputPath, "utf8");
const data = parseCSV(csv);

// quick sanity checks
for (let lvl = 1; lvl <= 200; lvl++) {
  if (!data[String(lvl)]) {
    console.warn(`Warning: missing level ${lvl} in CSV`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
console.log(`✅ Wrote ${outputPath} with ${Object.keys(data).length} levels.`);
