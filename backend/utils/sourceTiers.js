/**
 * Source Quality Tier System
 * Used for ranking weight, certainty, and tone adjustments
 *
 * Tiers:
 * - A: Tier 1 trusted sources (Reuters, AP, Bloomberg, WSJ, FT, CNBC, Yahoo Finance)
 * - B: Tier 2 quality sources (MarketWatch, Seeking Alpha, Motley Fool, Investopedia)
 * - C: Tier 3 niche/specialized sources (crypto sites, sector analysts, regional outlets)
 * - D: Tier 4 opinion/hype sources (Benzinga, SeekingAlpha opinion pieces, retail blogs)
 */

const SOURCE_TIER_MAP = {
  // Tier A: Premium trusted sources
  reuters: 'A',
  'reuters.com': 'A',
  apnews: 'A',
  'ap.org': 'A',
  bloomberg: 'A',
  'bloomberg.com': 'A',
  wsj: 'A',
  'wsj.com': 'A',
  'wall street journal': 'A',
  ft: 'A',
  'ft.com': 'A',
  'financial times': 'A',
  cnbc: 'A',
  'cnbc.com': 'A',
  'yahoo finance': 'B', // Semi-trusted, republishes content
  'finance.yahoo.com': 'B',
  marketwatch: 'B',
  'marketwatch.com': 'B',
  'financial times': 'A',
  economist: 'A',
  'economist.com': 'A',

  // Tier B: Quality sources with editorial standards
  'seeking alpha': 'B',
  seekingalpha: 'B',
  'seekingalpha.com': 'B',
  'motley fool': 'B',
  motionfool: 'B',
  'motionfool.com': 'B',
  investopedia: 'B',
  'investopedia.com': 'B',
  'investor place': 'B',
  'investor.com': 'B',
  barrons: 'B',
  'barrons.com': 'B',
  'investor\'s business daily': 'B',
  ibd: 'B',

  // Tier C: Crypto, niche, specialized
  coindesk: 'C',
  'coindesk.com': 'C',
  'crypto.com': 'C',
  glassnode: 'C',
  'glassnode.com': 'C',
  messari: 'C',
  'messari.io': 'C',
  'the block': 'C',
  theblock: 'C',
  'theblock.co': 'C',
  cointelegraph: 'C',
  'cointelegraph.com': 'C',
  blockworks: 'C',
  'blockworks.co': 'C',

  // Tier D: Opinion, hype, prediction-heavy sources
  benzinga: 'D',
  'benzinga.com': 'D',
  'zacks investment': 'D',
  zacks: 'D',
  'zacks.com': 'D',
  'stockanalysis.com': 'D',
  stockanalysis: 'D',
  'tradingview.com': 'D',
  tradingview: 'D',
  stocktwits: 'D',
  'stocktwits.com': 'D',
  'seeking alpha opinion': 'D', // Opinion pieces within Seeking Alpha
  'motleyfoolfools.com': 'D', // Speculative content
};

/**
 * Language policy: phrases to reject or transform
 */
const HYPE_LANGUAGE_PATTERNS = [
  {
    pattern: /\bbullish\b/gi,
    replacement: 'positive sentiment',
    severity: 'transform', // 'transform' = reword, 'reject' = exclude
  },
  {
    pattern: /\bbearish\b/gi,
    replacement: 'negative sentiment',
    severity: 'transform',
  },
  {
    pattern: /\breclaim\b/gi,
    replacement: 'return to',
    severity: 'transform',
  },
  {
    pattern: /\bsets stage for\b/gi,
    replacement: 'may influence',
    severity: 'transform',
  },
  {
    pattern: /\bsoon\b/gi,
    replacement: 'potentially in the near term',
    severity: 'transform',
  },
  {
    pattern: /\brocket\b/gi,
    replacement: 'rise significantly',
    severity: 'transform',
  },
  {
    pattern: /\bto the moon\b/gi,
    replacement: 'sharp increase',
    severity: 'reject',
  },
  {
    pattern: /price (target|goal|forecast).*?\$[\d.]+/gi,
    replacement: '', // Remove price targets
    severity: 'reject',
  },
  {
    pattern: /\$\d+,?\d*\s*(target|goal|forecast|potential)/gi,
    replacement: '',
    severity: 'reject',
  },
];

/**
 * Get source tier for a given source name
 * @param {string} sourceName - Source name (e.g., "CNBC", "Reuters")
 * @returns {string} Tier: 'A', 'B', 'C', or 'D' (defaults to 'C' if unknown)
 */
function getSourceTier(sourceName) {
  if (!sourceName) return 'C';

  const normalized = sourceName.toLowerCase().trim();
  return SOURCE_TIER_MAP[normalized] || 'C'; // Default to Tier C for unknown sources
}

/**
 * Get ranking weight multiplier for a tier
 * @param {string} tier - Tier letter: 'A', 'B', 'C', 'D'
 * @returns {number} Weight multiplier
 */
function getTierRankingWeight(tier) {
  const weights = {
    'A': 1.3,   // +30% weight
    'B': 1.1,   // +10% weight
    'C': 1.0,   // baseline
    'D': 0.6,   // -40% weight (heavily downrank)
  };
  return weights[tier] || 1.0;
}

/**
 * Determine certainty adjustment based on source tier
 * @param {string} tier - Tier letter
 * @param {string} originalCertainty - Original certainty: 'Low', 'Medium', 'High'
 * @returns {string} Adjusted certainty
 */
function adjustCertaintyByTier(tier, originalCertainty) {
  const certaintyOrder = { 'Low': 0, 'Medium': 1, 'High': 2 };
  let level = certaintyOrder[originalCertainty] || 1;

  if (tier === 'A') {
    level = Math.min(2, level + 1); // Boost one notch
  } else if (tier === 'D') {
    level = Math.max(0, level - 1); // Reduce one notch
  }

  const reverseLookup = ['Low', 'Medium', 'High'];
  return reverseLookup[level] || 'Medium';
}

/**
 * Check if content violates language policy and apply transformations
 * @param {string} text - Text to check
 * @returns {object} { isValid: boolean, transformedText: string, violations: array }
 */
function checkLanguagePolicy(text) {
  if (!text || typeof text !== 'string') {
    return { isValid: true, transformedText: text, violations: [] };
  }

  let transformed = text;
  const violations = [];
  let hasRejects = false;

  for (const rule of HYPE_LANGUAGE_PATTERNS) {
    const matches = text.match(rule.pattern);
    if (matches) {
      violations.push({
        pattern: rule.pattern.source,
        matches: matches,
        severity: rule.severity,
      });

      if (rule.severity === 'reject') {
        hasRejects = true;
      }

      transformed = transformed.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    isValid: !hasRejects,
    transformedText: transformed,
    violations,
    hasHypeLanguage: violations.length > 0,
  };
}

/**
 * Should we downrank this source?
 * @param {string} sourceName - Source name
 * @returns {boolean}
 */
function shouldDownrank(sourceName) {
  const tier = getSourceTier(sourceName);
  return tier === 'D';
}

/**
 * Is this source allowed as primary?
 * (Tier D sources can be supporting context but shouldn't be featured)
 * @param {string} sourceName - Source name
 * @param {number} tierDArticleCount - How many Tier D articles are in this signal
 * @returns {boolean}
 */
function isAllowedAsPrimary(sourceName, tierDArticleCount = 0) {
  const tier = getSourceTier(sourceName);

  // If Tier D and we already have other sources, don't feature it
  if (tier === 'D' && tierDArticleCount > 0) {
    return false;
  }

  return true;
}

module.exports = {
  SOURCE_TIER_MAP,
  HYPE_LANGUAGE_PATTERNS,
  getSourceTier,
  getTierRankingWeight,
  adjustCertaintyByTier,
  checkLanguagePolicy,
  shouldDownrank,
  isAllowedAsPrimary,
};
