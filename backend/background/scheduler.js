/**
 * Scheduler
 * Coordinates background jobs that run automatically
 */

const { runIngest } = require("./ingestJob");
const { runProcess } = require("./processJob");
const { runRank } = require("./rankJob");

/**
 * Start scheduler (if not disabled)
 */
function startScheduler() {
  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("[Scheduler] Disabled (DISABLE_SCHEDULER=true)");
    return;
  }

  console.log("[Scheduler] Starting...");
  
  // Every 20 minutes: ingest
  setInterval(async () => {
    await runIngest();
  }, 20 * 60 * 1000);

  // Every 2 minutes: process
  setInterval(async () => {
    await runProcess();
  }, 2 * 60 * 1000);

  // Every 10 minutes: rank
  setInterval(async () => {
    await runRank();
  }, 10 * 60 * 1000);

  // Run once immediately on startup (with delay to let server start)
  setTimeout(async () => {
    console.log("[Scheduler] Running initial tasks...");
    await runIngest();
    setTimeout(async () => {
      await runProcess();
      setTimeout(async () => {
        await runRank();
      }, 5000);
    }, 10000);
  }, 30000); // Wait 30 seconds after server start

  console.log("[Scheduler] Started");
}

module.exports = {
  startScheduler,
};

/**
 * Start scheduler (if not disabled)
 */
function startScheduler() {
  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("[Worker] Scheduler disabled (DISABLE_SCHEDULER=true)");
    return;
  }

  console.log("[Worker] Starting scheduler...");
  
  // Every 20 minutes: ingest
  setInterval(async () => {
    await runIngest();
  }, 20 * 60 * 1000);

  // Every 2 minutes: process
  setInterval(async () => {
    await runProcess();
  }, 2 * 60 * 1000);

  // Every 10 minutes: rank
  setInterval(async () => {
    await runRank();
  }, 10 * 60 * 1000);

  // Run once immediately on startup (with delay to let server start)
  setTimeout(async () => {
    console.log("[Worker] Running initial tasks...");
    await runIngest();
    setTimeout(async () => {
      await runProcess();
      setTimeout(async () => {
        await runRank();
      }, 5000);
    }, 10000);
  }, 30000); // Wait 30 seconds after server start

  console.log("[Worker] Scheduler started");
}

module.exports = {
  runIngest,
  runProcess,
  runRank,
  startScheduler,
};

