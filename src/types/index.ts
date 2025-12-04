/**
 * Core types for Wealthy Rabbit - Holdings-Aware Financial News Assistant
 */

/**
 * Represents a user's holding (stock ticker)
 */
export interface Holding {
  id?: number; // Database ID (optional for frontend-only creation before save)
  ticker: string; // e.g., "AAPL", "MSFT", "NVDA" (required)
  label?: string; // Optional display label, e.g. "Nvidia", "Apple Inc."
  notes?: string; // Optional notes about the holding
}

/**
 * Basic article structure from news API
 */
export interface Article {
  source: {
    id: string | null;
    name: string;
  };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
  feedSource?: string; // "gnews" or "newsapi" - which API fetched this article
}

/**
 * Relevance score for a specific holding
 */
export interface RelevanceScore {
  ticker: string;
  score: number; // 0-100, where 100 is most relevant
  reasoning?: string; // Optional explanation of why this score
}

/**
 * Relevance scores mapped by ticker
 */
export interface RelevanceScores {
  [ticker: string]: number; // Ticker -> relevance score (0-100)
}

/**
 * Triage information for article filtering
 */
export interface TriageInfo {
  shouldEnrich: boolean; // Whether article should be enriched
  reason?: string; // Reason why article should/shouldn't be enriched
  score?: number; // Triage score (0-100)
}

/**
 * Enriched article with LLM-generated insights
 */
export interface EnrichedArticle extends Article {
  // LLM-generated summary (concise version of the article)
  summary: string;
  
  // LLM-generated explanation of why this matters to investors
  whyItMatters: string;
  
  // Relevance scores for each holding the user owns
  relevanceScores: RelevanceScores;
  
  // Optional: Detailed relevance scores with reasoning
  detailedRelevanceScores?: RelevanceScore[];
  
  // Optional: Triage information (if article was filtered out)
  triageReason?: string; // Why article was not enriched
  triageScore?: number; // Triage score (0-100)
}

