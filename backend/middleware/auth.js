/**
 * Middleware to require internal API key for protected endpoints
 */
function requireInternalKey(req, res, next) {
  const providedKey = req.headers['x-internal-key'];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.warn("[Auth] INTERNAL_API_KEY not set in environment");
    return res.status(500).json({ error: "Internal API key not configured" });
  }

  if (!providedKey || providedKey !== expectedKey) {
    console.warn(`[Auth] Invalid or missing internal API key from ${req.ip}`);
    return res.status(403).json({ error: "Forbidden: Invalid or missing internal API key" });
  }

  next();
}

/**
 * Middleware to extract user ID from header (for v1 endpoints)
 * Does not enforce authentication - just extracts if present
 */
function extractUserId(req, res, next) {
  const userId = req.headers['x-user-id'];
  req.userId = userId ? parseInt(userId, 10) : 1; // Default to user 1 for MVP
  next();
}

module.exports = {
  requireInternalKey,
  extractUserId,
};



