/**
 * Guardrails service to enforce Signal safety rules
 * Prevents advice language and ensures safe action/verdict values
 */

const ADVICE_WORDS = [
  "buy", "sell", "entry point", "undervalued", "overvalued",
  "load up", "invest now", "should buy", "should sell"
];

const ALLOWED_ACTIONS = [
  "Do nothing",
  "Understand the context",
  "Review allocation",
  "Rebalance to target"
];

const ALLOWED_VERDICTS = ["ignore", "aware", "act"];

const ALLOWED_OPPORTUNITY_TYPES = ["none", "behavioral", "awareness", "allocation"];

/**
 * Check if text contains any advice words (case-insensitive)
 */
function containsAdviceWords(text) {
  if (!text || typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return ADVICE_WORDS.some(word => lowerText.includes(word.toLowerCase()));
}

/**
 * Enforce guardrails on a Signal object
 * @param {Object} signal - Signal object to clean
 * @returns {Object} - Cleaned signal object
 */
function enforceSignalGuardrails(signal) {
  if (!signal || typeof signal !== 'object') {
    // Return safe defaults if signal is invalid
    return {
      verdict: "aware",
      why: [],
      action: "Do nothing",
      horizon: signal?.horizon || null,
      opportunity_type: "none",
      opportunity_note: "",
      confidence: signal?.confidence || 0,
      importance_score: signal?.importance_score || 0,
    };
  }

  const cleaned = { ...signal };

  // 1. Enforce verdict
  if (!ALLOWED_VERDICTS.includes(cleaned.verdict)) {
    cleaned.verdict = "aware";
  }

  // 2. Enforce why array (max length 3)
  if (Array.isArray(cleaned.why)) {
    cleaned.why = cleaned.why.slice(0, 3);
  } else if (typeof cleaned.why === 'string') {
    // Convert string to array
    cleaned.why = [cleaned.why].slice(0, 3);
  } else {
    cleaned.why = [];
  }

  // 3. Enforce action
  if (!ALLOWED_ACTIONS.includes(cleaned.action)) {
    cleaned.action = "Do nothing";
  }

  // 4. Enforce opportunity_type
  if (!ALLOWED_OPPORTUNITY_TYPES.includes(cleaned.opportunity_type)) {
    cleaned.opportunity_type = "none";
  }

  // 5. Check for advice words in title, why, action, opportunity_note
  const titleText = cleaned.title || "";
  const whyText = Array.isArray(cleaned.why) ? cleaned.why.join(" ") : (cleaned.why || "");
  const actionText = cleaned.action || "";
  const opportunityNoteText = cleaned.opportunity_note || "";

  const hasAdviceWords = 
    containsAdviceWords(titleText) ||
    containsAdviceWords(whyText) ||
    containsAdviceWords(actionText) ||
    containsAdviceWords(opportunityNoteText);

  // 6. If advice words found, downgrade signal
  if (hasAdviceWords) {
    console.warn(`[Guardrails] Advice words detected in signal, downgrading: ${cleaned.url || 'unknown'}`);
    cleaned.verdict = "aware";
    cleaned.action = "Do nothing";
    cleaned.opportunity_type = "none";
    cleaned.opportunity_note = "";
    
    // Also clean why array if it contains advice
    if (Array.isArray(cleaned.why)) {
      cleaned.why = cleaned.why.filter(item => !containsAdviceWords(item));
      if (cleaned.why.length === 0) {
        cleaned.why = ["Content reviewed for context"];
      }
    }
  }

  // 7. Ensure numeric fields are valid
  cleaned.confidence = typeof cleaned.confidence === 'number' 
    ? Math.max(0, Math.min(100, cleaned.confidence)) 
    : 0;
  
  cleaned.importance_score = typeof cleaned.importance_score === 'number'
    ? Math.max(0, Math.min(100, cleaned.importance_score))
    : (cleaned.final_rank_score || 0);

  return cleaned;
}

module.exports = {
  enforceSignalGuardrails,
  containsAdviceWords,
};

