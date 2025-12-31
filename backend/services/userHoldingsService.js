/**
 * User Holdings Service
 * Retrieves user holdings from the database
 */

const { getDatabase } = require("../data/db");

/**
 * Get holdings for a specific user
 * @param {number} userId - User ID
 * @returns {Array<string>} Array of ticker symbols (e.g., ["TSLA", "NVDA", "IBIT"])
 */
function getUserHoldings(userId) {
  try {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT ticker FROM holdings WHERE user_id = ? ORDER BY ticker ASC")
      .all(userId);

    // Return array of ticker strings
    return rows.map(row => row.ticker);
  } catch (error) {
    console.error(`[Holdings] Error fetching holdings for user ${userId}:`, error.message);
    return []; // Return empty array on error (user has no holdings)
  }
}

/**
 * Get detailed holdings for a specific user
 * @param {number} userId - User ID
 * @returns {Array<Object>} Array of holding objects with ticker, label, notes
 */
function getUserHoldingsDetailed(userId) {
  try {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT id, ticker, label, notes FROM holdings WHERE user_id = ? ORDER BY ticker ASC")
      .all(userId);

    return rows;
  } catch (error) {
    console.error(`[Holdings] Error fetching detailed holdings for user ${userId}:`, error.message);
    return [];
  }
}

module.exports = {
  getUserHoldings,
  getUserHoldingsDetailed,
};
