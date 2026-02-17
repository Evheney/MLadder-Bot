function formatNumber(num) {
  if (num === 0) return "0";

  const units = [
    { value: 1e15, symbol: "P" },
    { value: 1e12, symbol: "T" },
    { value: 1e9,  symbol: "G" },
    { value: 1e6,  symbol: "M" },
    { value: 1e3,  symbol: "K" }
  ];

  for (const unit of units) {
    if (num >= unit.value) {
      const formatted = (num / unit.value).toFixed(2).replace(/\.00$/, "");
      return formatted + unit.symbol;
    }
  }

  return num.toString();
}

module.exports = formatNumber;
