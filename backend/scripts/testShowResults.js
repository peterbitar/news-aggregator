const { getDatabase, initDatabase } = require("../data/db");

initDatabase();
const db = getDatabase();

const stats = db.prepare(`
  SELECT COUNT(*) as total FROM articles
`).get();

console.log("\n📊 DATABASE STATS:");
console.log(`Total articles: ${stats.total}`);
process.exit(0);
