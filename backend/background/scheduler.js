/**
 * Scheduler
 * Coordinates background jobs that run automatically
 */

const { runIngest } = require("./ingestJob");
const { runProcess } = require("./processJob");
const { runRank } = require("./rankJob");

// Guard to ensure scheduler is only initialized once
let isInitialized = false;

/**
 * Start scheduler (if not disabled)
 * Ensures only one instance is created
 */
function startScheduler() {
  // Prevent double initialization
  if (isInitialized) {
    console.log("[Scheduler] Already initialized, skipping");
    return;
  }

  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("[Scheduler] Disabled (DISABLE_SCHEDULER=true)");
    return;
  }

  isInitialized = true;
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
  // Note: These will be skipped if already running due to locks in each job
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

