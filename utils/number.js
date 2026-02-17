function parseValue(raw) {
  if (raw === undefined || raw === null) return 0;
  let s = String(raw).trim();
  if (!s || s.toLowerCase() === "n/a") return 0;

  s = s.replace(/,/g, "").replace(/\s+/g, "");

  const m = s.match(/^(\d+(\.\d+)?)([KMGTP])?$/i);
  if (!m) {
    throw new Error(`Bad value: "${raw}" (use number or K/M/G/T/P, e.g. 5G, 120M)`);
  }

  const num = Number(m[1]);
  const suf = (m[3] || "").toUpperCase();

  const mult =
    suf === "K" ? 1e3 :
    suf === "M" ? 1e6 :
    suf === "G" ? 1e9 :
    suf === "T" ? 1e12 :
    suf === "P" ? 1e15 : 1;

  return Math.round(num * mult);
}

function formatValue(num) {
  num = Number(num) || 0;
  if (num === 0) return "0";

  const units = [
    { value: 1e15, symbol: "P" },
    { value: 1e12, symbol: "T" },
    { value: 1e9, symbol: "G" },
    { value: 1e6, symbol: "M" },
    { value: 1e3, symbol: "K" },
  ];

  for (const u of units) {
    if (num >= u.value) {
      const x = num / u.value;
      // keep it readable but not noisy
      const s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
      return s.replace(/\.0+$|(\.\d*[1-9])0+$/, "$1") + u.symbol;
    }
  }
  return String(num);
}

module.exports = { parseValue, formatValue };
