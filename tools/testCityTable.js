const table = require("../tables/cityTable.json");
const formatNumber = require("./FormatNumber");

function show(level) {
  const city = table[level];

  console.log(`Level ${level}`);
  console.log(`Wall: ${formatNumber(city.wall)}`);
  console.log(`Upgrade Cost: ${formatNumber(city.upgradeCost)}`);
  console.log("-----------");
}

show(1);
show(2);
show(140);
show(200);
