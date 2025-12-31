import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import HoldingsPanel from "./HoldingsPanel";
import TimeFilter, { TimeFilter as TimeFilterType } from "./TimeFilter";
import SourceFilter, { SourceFilter as SourceFilterType } from "./SourceFilter";
import ApiTestPage from "./ApiTestPage";
import { Article, EnrichedArticle, Holding } from "../types";
import { formatPublishedDate, getBackendUrl } from "../utils/newsAggregator.utils";
import * as S from "./NewsAggregator.styles";

const fetchNews = async ({
  queryKey,
}: {
  queryKey: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean, string[], Record<string, number>];
}) => {
  const [, viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdings, shouldScrape, selectedSources, sourceLimits] = queryKey;
  const BACKEND_URL = getBackendUrl();

  // If viewing feed, use feed endpoint
  if (viewMode === "feed") {
    try {
      const response = await axios.get(`${BACKEND_URL}/api/feed`, {
        params: {
          from: timeFilter.fromDate || undefined,
          to: timeFilter.toDate || undefined,
          sources: sourceFilter.sources && sourceFilter.sources.length > 0 ? sourceFilter.sources.join(',') : undefined,
          limit: 100,
          minScore: 40,
        },
      });
      return response.data.articles || [];
    } catch (error: any) {
      console.error("[fetchNews] Error fetching feed:", error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data?.error || "Failed to fetch feed articles");
      }
      throw error;
    }
  }

  // If viewing discarded articles, use discarded endpoint
  if (viewMode === "discarded") {
    try {
      const params: any = {
        limit: 100,
      };
      if (timeFilter.fromDate) params.from = timeFilter.fromDate;
      if (timeFilter.toDate) params.to = timeFilter.toDate;
      if (sourceFilter.sources && sourceFilter.sources.length > 0) {
        params.sources = sourceFilter.sources.join(',');
      }
      if (holdings && Array.isArray(holdings) && holdings.length > 0) {
        params.holdings = holdings.join(',');
      }
      
      const response = await axios.get(`${BACKEND_URL}/api/articles/discarded`, { params });
      return response.data.articles || [];
    } catch (error: any) {
      console.error("[fetchNews] Error fetching discarded articles:", error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data?.error || "Failed to fetch discarded articles");
      }
      throw error;
    }
  }

  // If enriched mode is enabled, use enriched endpoint
  if (useEnriched) {
    // If no holdings, fetch all articles from DB (backend supports empty holdings array for cached articles)
    const holdingsToUse = (holdings && Array.isArray(holdings) && holdings.length > 0) ? holdings : [];
    
    try {
      // Use selectedSources for scraping, sourceFilter.sources for filtering displayed results
      const sourcesToUse = shouldScrape && selectedSources && selectedSources.length > 0 
        ? selectedSources 
        : (sourceFilter.sources && sourceFilter.sources.length > 0 ? sourceFilter.sources : undefined);

      const response = await axios.post(`${BACKEND_URL}/api/news/holdings/enriched`, {
        holdings: holdingsToUse, // Empty array to fetch all articles, or holdings array if available
        page: currentPage,
        from: timeFilter.fromDate || undefined,
        to: timeFilter.toDate || undefined,
        sources: sourcesToUse,
        sourceLimits: sourceLimits || { newsapi: 10, gnews: 10, googlerss: 10 }, // Pass per-source article limits
        scrape: shouldScrape,
      });
      console.log(`[fetchNews] Received ${response.data.articles?.length || 0} articles from enriched endpoint, scrape was: ${shouldScrape}`);
      return response.data.articles || [];
    } catch (error: any) {
      // If error and no holdings, fall back to regular endpoint
      if (holdingsToUse.length === 0) {
        console.warn("[fetchNews] Enriched endpoint failed with no holdings, falling back to regular endpoint");
        // Fall through to regular endpoint below
      } else {
        // Re-throw with more context for holdings-related errors
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const errorData = error.response.data;
          console.error("[fetchNews] 404 error:", errorData);
          const errorMsg = errorData?.error || `No holdings found. Please add holdings in the Holdings Panel first.`;
          const details = errorData?.availableHoldings 
            ? ` Available holdings: ${errorData.availableHoldings.join(', ')}. Provided: ${holdings.join(', ')}.`
            : errorData?.providedTickers
            ? ` Provided tickers: ${errorData.providedTickers.join(', ')}.`
            : '';
          throw new Error(errorMsg + details);
        }
        throw error;
      }
    }
  }

      // Otherwise, use regular news endpoint
      const params = new URLSearchParams();
      
      if (searchTerm) {
        params.append("search", searchTerm);
      } else {
        params.append("category", category);
      }
      
      params.append("page", currentPage.toString());
      
      // Add scrape parameter (only scrape when explicitly requested)
      if (shouldScrape) {
        params.append("scrape", "true");
      }
      
      // Add date filters if provided
      if (timeFilter.fromDate) {
        params.append("from", timeFilter.fromDate);
      }
      if (timeFilter.toDate) {
        params.append("to", timeFilter.toDate);
      }

      // Add source filter if provided
      if (sourceFilter.sources && sourceFilter.sources.length > 0) {
        params.append("sources", sourceFilter.sources.join(","));
      }
      
      // Add source limits if provided
      if (sourceLimits) {
        params.append("sourceLimits", JSON.stringify(sourceLimits));
      }

      const url = `${BACKEND_URL}/api/news?${params.toString()}`;
      const response = await axios.get(url);
      return response.data.articles || [];
};

type ViewMode = "all" | "feed" | "discarded";

const NewsAggregator: React.FC = () => {
  const queryClient = useQueryClient();
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("wealthyRabbitViewMode") as ViewMode) || "all";
  });
  
  const [category, setCategory] = useState<string>(() => {
    return localStorage.getItem("newsCategory") || "business";
  });

  const [searchTerm, setSearchTerm] = useState<string>(() => {
    return localStorage.getItem("newsSearch") || "";
  });

  const [currentPage, setCurrentPage] = useState<number>(() => {
    return Number(localStorage.getItem("newsPage")) || 1;
  });

  const [shouldScrape, setShouldScrape] = useState<boolean>(false);
  const [selectedSources, setSelectedSources] = useState<string[]>(() => {
    const saved = localStorage.getItem("wealthyRabbitSelectedSources");
    return saved ? JSON.parse(saved) : ['newsapi', 'gnews', 'googlerss']; // Default: all sources
  });
  const [sourceLimits, setSourceLimits] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem("wealthyRabbitSourceLimits");
    return saved ? JSON.parse(saved) : { newsapi: 10, gnews: 10, googlerss: 10 }; // Default: 10 per source
  });
  const [clearLoading, setClearLoading] = useState<boolean>(false);
  const [pipelineLoading, setPipelineLoading] = useState<boolean>(false);
  const [rankingLoading, setRankingLoading] = useState<boolean>(false);
  const [stepMessage, setStepMessage] = useState<string>("");
  const [showApiTestPage, setShowApiTestPage] = useState<boolean>(false);
  const [scrapedArticleCount, setScrapedArticleCount] = useState<number | null>(null);

  // Time filter state
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>(() => {
    const saved = localStorage.getItem("wealthyRabbitTimeFilter");
    return saved ? JSON.parse(saved) : { option: "all" };
  });

  // Source filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilterType>(() => {
    const saved = localStorage.getItem("wealthyRabbitSourceFilter");
    return saved ? JSON.parse(saved) : { sources: [] };
  });

  // Enriched mode toggle
  const [useEnriched, setUseEnriched] = useState<boolean>(() => {
    const saved = localStorage.getItem("wealthyRabbitUseEnriched");
    return saved === "true";
  });

  // Fetch holdings for enriched mode
  const {
    data: holdings = [],
    isLoading: holdingsLoading,
  } = useQuery({
    queryKey: ["holdings"],
    queryFn: async () => {
      const response = await axios.get(`${getBackendUrl()}/api/holdings`);
      return response.data;
    },
    staleTime: 30 * 1000,
  });

  // Extract tickers for enriched endpoint
  const holdingsTickers = useMemo(() => {
    return holdings.map((h: Holding) => h.ticker).filter((t: string) => t && t.trim().length > 0);
  }, [holdings]);

  const {
    data: news = [],
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, shouldScrape, selectedSources, sourceLimits],
    queryFn: fetchNews,
    staleTime: shouldScrape ? 0 : 5 * 60 * 1000, // Force fresh data when scraping
    refetchOnWindowFocus: false,
    retry: (failureCount, error: any) => {
      // Don't retry if it's a 404 (holdings not found) or if enriched mode is on but no holdings
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
    enabled: viewMode === "feed" 
      ? true // Feed is always enabled
      : useEnriched 
        ? !holdingsLoading // For enriched: wait for holdings to load, but still enable even if no holdings (will show error)
        : true, // For regular news: always enabled
  });

  const handleCategoryButtonClick = (newCategory: string) => {
    // only update if different
    if (newCategory !== category) {
      setCategory(newCategory);
      setCurrentPage(1);
      setShouldScrape(false); // Always use cached articles when filters change
      setScrapedArticleCount(null); // Reset scraped count when filters change
      localStorage.setItem("newsCategory", newCategory);
      localStorage.setItem("newsPage", "1");
    }
  };

  const handleTimeFilterChange = (filter: TimeFilterType) => {
    setTimeFilter(filter);
    setCurrentPage(1); // Reset to first page when filter changes
    setShouldScrape(false); // Always use cached articles when filters change
    setScrapedArticleCount(null); // Reset scraped count when filters change
    localStorage.setItem("wealthyRabbitTimeFilter", JSON.stringify(filter));
    localStorage.setItem("newsPage", "1");
  };

  const handleSourceFilterChange = (filter: SourceFilterType) => {
    setSourceFilter(filter);
    setCurrentPage(1); // Reset to first page when filter changes
    setShouldScrape(false); // Always use cached articles when filters change
    setScrapedArticleCount(null); // Reset scraped count when filters change
    localStorage.setItem("wealthyRabbitSourceFilter", JSON.stringify(filter));
    localStorage.setItem("newsPage", "1");
  };

  const handleEnrichedToggle = (enabled: boolean) => {
    setUseEnriched(enabled);
    setCurrentPage(1); // Reset to first page when mode changes
    setShouldScrape(false); // Always use cached articles when mode changes
    setScrapedArticleCount(null); // Reset scraped count when mode changes
    localStorage.setItem("wealthyRabbitUseEnriched", enabled.toString());
    localStorage.setItem("newsPage", "1");
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setShouldScrape(false); // Always use cached articles when search changes
    setScrapedArticleCount(null); // Reset scraped count when search changes
    localStorage.setItem("newsSearch", value);
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => {
      const newPage = prev + 1;
      setShouldScrape(false); // Always use cached articles when paginating
      localStorage.setItem("newsPage", newPage.toString());
      return newPage;
    });
  };

  const handlePrevPage = () => {
    setCurrentPage((prev) => {
      const newPage = Math.max(prev - 1, 1);
      setShouldScrape(false); // Always use cached articles when paginating
      localStorage.setItem("newsPage", newPage.toString());
      return newPage;
    });
  };

  // Reset shouldScrape to false after scraping completes
  // Only reset after data has been successfully fetched (not just when loading becomes false)
  useEffect(() => {
    // Only reset if: not loading, scrape was requested, and we have articles (successful fetch)
    if (!loading && shouldScrape && news.length > 0) {
      // Scraping just completed successfully, reset the flag so next query uses cache
      console.log("[useEffect] Scraping completed successfully, resetting shouldScrape to false");
      setShouldScrape(false);
    }
  }, [loading, shouldScrape, news.length]);

  // Legacy triage and enrich handlers removed - use handlePipelineProcess instead

  // Handle clear database
  const handleClearDatabase = async () => {
    if (!window.confirm("Are you sure you want to clear ALL articles from the database? This cannot be undone.")) {
      return;
    }
    setClearLoading(true);
    setStepMessage("");
    try {
      const response = await axios.delete(`${getBackendUrl()}/api/articles/clear`);
      setStepMessage(`✅ Database cleared: ${response.data.deleted} articles deleted`);
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error: any) {
      setStepMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setClearLoading(false);
    }
  };

  // Handle full pipeline processing (Stages 1-4)
  const handlePipelineProcess = async () => {
    if (holdingsTickers.length === 0) {
      setStepMessage(`❌ Error: Please add holdings first before processing articles`);
      return;
    }

    setPipelineLoading(true);
    setStepMessage("");
    try {
      const response = await axios.post(`${getBackendUrl()}/internal/process`,
        {
          limit: 50,
          userProfile: "balanced",
        },
        {
          headers: {
            'x-internal-key': process.env.REACT_APP_INTERNAL_API_KEY || ''
          }
        }
      );
      setStepMessage(`✅ Pipeline processing complete: ${response.data.processed || 0} articles processed through Stages 1-4`);
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error: any) {
      setStepMessage(`❌ Error: ${error.response?.data?.error || error.response?.data?.message || error.message}`);
    } finally {
      setPipelineLoading(false);
    }
  };

  // Handle Stage 5 ranking
  const handleRanking = async () => {
    setRankingLoading(true);
    setStepMessage("");
    try {
      const response = await axios.post(`${getBackendUrl()}/internal/rank`,
        {
          cutoffScore: 50,
          limit: 50,
        },
        {
          headers: {
            'x-internal-key': process.env.REACT_APP_INTERNAL_API_KEY || ''
          }
        }
      );
      setStepMessage(`✅ Ranking complete: Articles ranked and clustered`);
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error: any) {
      setStepMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setRankingLoading(false);
    }
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setCurrentPage(1);
    setShouldScrape(false);
    localStorage.setItem("wealthyRabbitViewMode", mode);
    localStorage.setItem("newsPage", "1");
  };

  if (showApiTestPage) {
    return <ApiTestPage onBack={() => setShowApiTestPage(false)} />;
  }

  return (
    <S.Container>
      <S.Title>🐰 Wealthy Rabbit</S.Title>
      <div style={{ textAlign: "center", marginBottom: "16px" }}>
        <S.ScrapeButton
          onClick={() => setShowApiTestPage(true)}
          $bgColor="#6366f1"
          style={{ margin: "0 auto" }}
        >
          🧪 Test /api/articles Endpoint
        </S.ScrapeButton>
      </div>
      <HoldingsPanel />
      <S.TabContainer>
        <S.TabButton $active={viewMode === "all"} onClick={() => handleViewModeChange("all")}>
          📰 All News
        </S.TabButton>
        <S.TabButton $active={viewMode === "feed"} onClick={() => handleViewModeChange("feed")}>
          ⭐ My Feed
        </S.TabButton>
        <S.TabButton $active={viewMode === "discarded"} onClick={() => handleViewModeChange("discarded")}>
          🗑️ Discarded
        </S.TabButton>
      </S.TabContainer>
      {viewMode === "feed" && (
        <div style={{ 
          padding: "12px", 
          backgroundColor: "#f0f9ff", 
          borderRadius: "8px", 
          marginBottom: "16px",
          border: "1px solid #bae6fd",
          fontSize: "0.875rem",
          color: "#0369a1"
        }}>
          💡 <strong>My Feed</strong> shows articles that have completed all processing stages (personalized and ranked). 
          These are the most relevant articles for your holdings, sorted by relevance score.
        </div>
      )}
      {viewMode === "discarded" && (
        <div style={{ 
          padding: "12px", 
          backgroundColor: "#fef2f2", 
          borderRadius: "8px", 
          marginBottom: "16px",
          border: "1px solid #fecaca",
          fontSize: "0.875rem",
          color: "#991b1b"
        }}>
          🗑️ <strong>Discarded Articles</strong> shows articles that were filtered out during the triage and classification stages. 
          Each article displays the reason why it was discarded. Use this view to review and understand the filtering logic.
        </div>
      )}
      {viewMode === "all" && (
        <S.SearchContainer>
        <S.SearchBox
          type="text"
          placeholder="Search for news..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        </S.SearchContainer>
      )}
      {viewMode === "all" && (
        <>
          <TimeFilter value={timeFilter} onChange={handleTimeFilterChange} />
          <SourceFilter value={sourceFilter} onChange={handleSourceFilterChange} />
        </>
      )}
      {viewMode === "feed" && (
        <>
          <TimeFilter value={timeFilter} onChange={handleTimeFilterChange} />
          <SourceFilter value={sourceFilter} onChange={handleSourceFilterChange} />
        </>
      )}
      {viewMode === "discarded" && (
        <>
          <TimeFilter value={timeFilter} onChange={handleTimeFilterChange} />
          <SourceFilter value={sourceFilter} onChange={handleSourceFilterChange} />
        </>
      )}
      {viewMode === "all" && (
        <>
          <S.SourceCheckboxContainer>
            <span style={{ fontWeight: 600, color: "#374151", marginRight: "8px" }}>Scrape from:</span>
            <span style={{ fontSize: "0.75rem", color: "#6b7280", marginLeft: "auto" }}>Max articles per source:</span>
            <S.SourceCheckboxLabel>
              <S.SourceCheckbox
                type="checkbox"
                checked={selectedSources.includes('newsapi')}
                onChange={(e) => {
                  const newSources = e.target.checked
                    ? [...selectedSources, 'newsapi']
                    : selectedSources.filter(s => s !== 'newsapi');
                  setSelectedSources(newSources);
                  localStorage.setItem("wealthyRabbitSelectedSources", JSON.stringify(newSources));
                }}
              />
              <S.SourceCheckboxText>NewsAPI</S.SourceCheckboxText>
              <S.SourceLimitInput
                type="number"
                min="1"
                max="100"
                value={sourceLimits.newsapi || 10}
                disabled={!selectedSources.includes('newsapi')}
                onChange={(e) => {
                  const value = Math.max(1, Math.min(100, parseInt(e.target.value) || 10));
                  const newLimits = { ...sourceLimits, newsapi: value };
                  setSourceLimits(newLimits);
                  localStorage.setItem("wealthyRabbitSourceLimits", JSON.stringify(newLimits));
                }}
                title="Max articles from NewsAPI"
              />
            </S.SourceCheckboxLabel>
            <S.SourceCheckboxLabel>
              <S.SourceCheckbox
                type="checkbox"
                checked={selectedSources.includes('gnews')}
                onChange={(e) => {
                  const newSources = e.target.checked
                    ? [...selectedSources, 'gnews']
                    : selectedSources.filter(s => s !== 'gnews');
                  setSelectedSources(newSources);
                  localStorage.setItem("wealthyRabbitSelectedSources", JSON.stringify(newSources));
                }}
              />
              <S.SourceCheckboxText>GNews</S.SourceCheckboxText>
              <S.SourceLimitInput
                type="number"
                min="1"
                max="100"
                value={sourceLimits.gnews || 10}
                disabled={!selectedSources.includes('gnews')}
                onChange={(e) => {
                  const value = Math.max(1, Math.min(100, parseInt(e.target.value) || 10));
                  const newLimits = { ...sourceLimits, gnews: value };
                  setSourceLimits(newLimits);
                  localStorage.setItem("wealthyRabbitSourceLimits", JSON.stringify(newLimits));
                }}
                title="Max articles from GNews"
              />
            </S.SourceCheckboxLabel>
            <S.SourceCheckboxLabel>
              <S.SourceCheckbox
                type="checkbox"
                checked={selectedSources.includes('googlerss')}
                onChange={(e) => {
                  const newSources = e.target.checked
                    ? [...selectedSources, 'googlerss']
                    : selectedSources.filter(s => s !== 'googlerss');
                  setSelectedSources(newSources);
                  localStorage.setItem("wealthyRabbitSelectedSources", JSON.stringify(newSources));
                }}
              />
              <S.SourceCheckboxText>Google RSS</S.SourceCheckboxText>
              <S.SourceLimitInput
                type="number"
                min="1"
                max="100"
                value={sourceLimits.googlerss || 10}
                disabled={!selectedSources.includes('googlerss')}
                onChange={(e) => {
                  const value = Math.max(1, Math.min(100, parseInt(e.target.value) || 10));
                  const newLimits = { ...sourceLimits, googlerss: value };
                  setSourceLimits(newLimits);
                  localStorage.setItem("wealthyRabbitSourceLimits", JSON.stringify(newLimits));
                }}
                title="Max articles from Google RSS"
              />
            </S.SourceCheckboxLabel>
          </S.SourceCheckboxContainer>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            <S.ScrapeButton
              onClick={async () => {
                console.log("[ScrapeButton] Clicked - directly calling API with scrape=true");
                console.log("[ScrapeButton] Selected sources:", selectedSources);
                
                // Reset scraped count at start of new scrape
                setScrapedArticleCount(null);
                
                // Ensure at least one source is selected
                if (selectedSources.length === 0) {
                  alert("Please select at least one source to scrape from.");
                  return;
                }
                
                try {
                  const BACKEND_URL = getBackendUrl();
                  let response;
                  
                  // If user has holdings, use enriched endpoint
                  // Otherwise, use regular news endpoint
                  if (holdingsTickers && holdingsTickers.length > 0) {
                    // Enriched news endpoint - uses holdings to search
                    console.log(`[ScrapeButton] Scraping enriched news for holdings: ${holdingsTickers.join(', ')}`);
                    response = await axios.post(`${BACKEND_URL}/api/news/holdings/enriched`, {
                      holdings: holdingsTickers,
                      page: currentPage,
                      from: timeFilter.fromDate || undefined,
                      to: timeFilter.toDate || undefined,
                      sources: selectedSources.length > 0 ? selectedSources : undefined,
                      sourceLimits: sourceLimits, // Pass per-source article limits
                      scrape: true, // Force scrape
                    });
                  } else {
                    // Regular news endpoint - when no holdings
                    console.log(`[ScrapeButton] Scraping regular news for category: ${category} (no holdings)`);
                    const params = new URLSearchParams();
                    if (searchTerm) {
                      params.append("search", searchTerm);
                    } else {
                      params.append("category", category);
                    }
                    params.append("page", currentPage.toString());
                    params.append("scrape", "true");
                    if (timeFilter.fromDate) params.append("from", timeFilter.fromDate);
                    if (timeFilter.toDate) params.append("to", timeFilter.toDate);
                    if (selectedSources.length > 0) {
                      params.append("sources", selectedSources.join(','));
                    }
                    // Add source limits as JSON in query params
                    params.append("sourceLimits", JSON.stringify(sourceLimits));
                    
                    response = await axios.get(`${BACKEND_URL}/api/news?${params.toString()}`);
                  }
                
                console.log(`[ScrapeButton] Direct API call successful, received ${response.data.articles?.length || 0} articles`);
                console.log(`[ScrapeButton] Response cached flag: ${response.data.cached}, articles sample:`, response.data.articles?.slice(0, 3).map((a: any) => ({ title: a.title?.substring(0, 50), url: a.url })));
                
                // Check if we got new articles or same ones
                const articleUrls = (response.data.articles || []).map((a: any) => a.url);
                const uniqueUrls = new Set(articleUrls);
                console.log(`[ScrapeButton] Total articles: ${articleUrls.length}, Unique URLs: ${uniqueUrls.size}`);
                
                // Capture the fetched article count from the API response
                const fetchedCount = response.data.fetched || response.data.articles?.length || 0;
                setScrapedArticleCount(fetchedCount);
                
                // Update the query cache with the new data for BOTH scrape=true and scrape=false queryKeys
                const queryKeyWithScrape: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean, string[], Record<string, number>] = 
                  ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, true, selectedSources, sourceLimits];
                const queryKeyNoScrape: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean, string[], Record<string, number>] = 
                  ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, false, selectedSources, sourceLimits];
                
                // Set data in both caches so UI updates regardless of which queryKey is active
                queryClient.setQueryData(queryKeyWithScrape, response.data.articles || []);
                queryClient.setQueryData(queryKeyNoScrape, response.data.articles || []);
                
                // Don't set shouldScrape or invalidate - we already have the fresh data in cache
                // This prevents a double scrape when React Query refetches
              } catch (error: any) {
                console.error("[ScrapeButton] Error scraping articles:", error);
                const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message;
                const detailedError = error.response?.data?.details ? `\n\nDetails: ${error.response.data.details}` : '';
                alert(`Error scraping articles: ${errorMessage}${detailedError}`);
              }
            }}
            disabled={loading}
          >
            {loading ? "⏳ Scraping..." : "🔄 Scrape New Articles"}
          </S.ScrapeButton>
          {scrapedArticleCount !== null && (
            <span style={{ color: "#10b981", fontSize: "0.875rem", fontWeight: "600" }}>
              ✅ Scraped {scrapedArticleCount} article{scrapedArticleCount !== 1 ? "s" : ""}
            </span>
          )}
          {!loading && news.length > 0 && scrapedArticleCount === null && (
            <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              Showing {news.length} cached article{news.length !== 1 ? "s" : ""}. Click "Scrape" to fetch new ones.
            </span>
          )}
        </div>
        </>
      )}
      {/* Always show Pipeline and Ranking buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap", padding: "12px", backgroundColor: "#f0f9ff", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)", border: "1px solid #bae6fd" }}>
        <div style={{ width: "100%", marginBottom: "8px", fontSize: "0.875rem", fontWeight: "600", color: "#0369a1" }}>
          🔄 Full Pipeline Processing (5 Stages)
        </div>
        <S.ScrapeButton
          onClick={handlePipelineProcess}
          disabled={clearLoading || pipelineLoading || rankingLoading}
          $bgColor="#8b5cf6"
        >
          {pipelineLoading ? "⏳ Processing..." : "🚀 Run Full Pipeline (Stages 1-4)"}
        </S.ScrapeButton>
        <S.ScrapeButton
          onClick={handleRanking}
          disabled={clearLoading || pipelineLoading || rankingLoading}
          $bgColor="#f59e0b"
        >
          {rankingLoading ? "⏳ Ranking..." : "📊 Stage 5: Ranking & Clustering"}
        </S.ScrapeButton>
        {stepMessage && (
          <span style={{ color: stepMessage.includes("✅") ? "#10b981" : "#ef4444", fontSize: "0.875rem", marginLeft: "8px" }}>
            {stepMessage}
          </span>
        )}
        <div style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "8px", width: "100%" }}>
          Pipeline processes: Title Triage → Content Fetch → Classification → Personalization → Ranking
        </div>
      </div>

      {/* Show individual step buttons only when enriched mode is on and holdings exist */}
      {holdings.length > 0 && useEnriched && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap", padding: "12px", backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)" }}>
          <S.ScrapeButton
            onClick={handleClearDatabase}
            disabled={clearLoading || pipelineLoading || rankingLoading}
            $bgColor="#ef4444"
          >
            {clearLoading ? "⏳ Clearing..." : "🗑️ Clear Database"}
          </S.ScrapeButton>
        </div>
      )}
      {viewMode === "all" && (
        <S.ButtonGroup>
          {[
            "business",
            "technology",
            "general",
          ].map((cat) => (
            <S.Button
              key={cat}
              onClick={() => handleCategoryButtonClick(cat)}
              $active={category === cat}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </S.Button>
          ))}
        </S.ButtonGroup>
      )}
      {error ? (
        <S.LoadingState style={{ padding: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b" }}>
          ⚠️ Error: {error.message}
          {axios.isAxiosError(error) && error.response?.data?.error && (
            <div style={{ marginTop: "8px", fontSize: "0.875rem" }}>
              {error.response.data.error}
            </div>
          )}
          {axios.isAxiosError(error) && error.response?.data?.message && (
            <div style={{ marginTop: "8px", fontSize: "0.875rem" }}>
              {error.response.data.message}
            </div>
          )}
        </S.LoadingState>
      ) : loading ? (
        <S.LoadingState>Loading news...</S.LoadingState>
      ) : news.length === 0 ? (
        <div style={{ 
          padding: "24px", 
          backgroundColor: "#fff", 
          borderRadius: "8px", 
          textAlign: "center",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
        }}>
          {viewMode === "feed" ? (
            <>
              <h3 style={{ marginTop: 0, color: "#374151" }}>⭐ Your Feed is Empty</h3>
              <p style={{ color: "#6b7280", marginBottom: "16px" }}>
                No articles have completed all processing stages yet.
              </p>
              <div style={{ 
                padding: "16px", 
                backgroundColor: "#f0f9ff", 
                borderRadius: "8px",
                textAlign: "left",
                maxWidth: "600px",
                margin: "0 auto"
              }}>
                <p style={{ marginTop: 0, fontWeight: "600", color: "#0369a1" }}>To populate your feed:</p>
                <ol style={{ color: "#64748b", paddingLeft: "20px" }}>
                  <li>Go to <strong>"All News"</strong> tab</li>
                  <li>Click <strong>"🔄 Scrape New Articles"</strong> to fetch articles for your holdings (NVDA, AAPL)</li>
                  <li>Click <strong>"🚀 Run Full Pipeline (Stages 1-4)"</strong> to process articles</li>
                  <li>Click <strong>"📊 Stage 5: Ranking & Clustering"</strong> to rank articles</li>
                  <li>Return to <strong>"My Feed"</strong> to see your personalized articles</li>
                </ol>
              </div>
            </>
          ) : viewMode === "discarded" ? (
            <>
              <h3 style={{ marginTop: 0, color: "#374151" }}>🗑️ No Discarded Articles</h3>
              <p style={{ color: "#6b7280" }}>
                No articles have been discarded yet. Articles are discarded during the triage and classification stages.
              </p>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0, color: "#374151" }}>No articles found</h3>
              <p style={{ color: "#6b7280" }}>
                Try adjusting your filters or click "Scrape New Articles" to fetch fresh content.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <S.NewsGrid>
            {news.map((article: Article | EnrichedArticle, index: number) => {
              const isEnriched = "summary" in article && "relevanceScores" in article;
              const enrichedArticle = isEnriched ? (article as EnrichedArticle) : null;
              
              // Get top relevance scores (sorted by score, highest first)
              const topRelevanceScores = enrichedArticle?.relevanceScores
                ? Object.entries(enrichedArticle.relevanceScores)
                    .filter(([_, score]) => score > 0)
                    .sort(([_, a], [__, b]) => b - a)
                    .slice(0, 3) // Show top 3
                : [];

              return (
                <S.NewsCard key={`${article.url}-${index}`}>
                  {article.urlToImage && (
                    <img src={article.urlToImage} alt={article.title} />
                  )}
                  <h2>{article.title}</h2>
                  <S.ArticleMeta>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <p style={{ margin: 0 }}>{article.source.name}</p>
                      {article.feedSource && (
                        <S.FeedSourceBadge $source={article.feedSource}>
                          {article.feedSource === "gnews" ? "📰 GNews" : article.feedSource === "newsapi" ? "📡 NewsAPI" : article.feedSource}
                        </S.FeedSourceBadge>
                      )}
                    </div>
                    {article.publishedAt && (
                      <S.PublicationDate>
                        🕐 {formatPublishedDate(article.publishedAt)}
                      </S.PublicationDate>
                    )}
                  </S.ArticleMeta>
                  
                  {viewMode === "discarded" && article.discardReason && (
                    <S.EnrichmentSection>
                      <div style={{ 
                        padding: "12px", 
                        backgroundColor: "#fef2f2", 
                        borderRadius: "6px", 
                        border: "1px solid #fecaca",
                        marginTop: "8px"
                      }}>
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "8px", 
                          marginBottom: "4px" 
                        }}>
                          <span style={{ fontSize: "1rem" }}>🗑️</span>
                          <strong style={{ color: "#991b1b", fontSize: "0.875rem" }}>
                            Discarded Reason:
                          </strong>
                        </div>
                        <p style={{ 
                          color: "#7f1d1d", 
                          fontSize: "0.875rem", 
                          margin: "4px 0 0 0",
                          fontStyle: "italic"
                        }}>
                          {article.discardReason}
                        </p>
                        {article.titleRelevance !== null && article.titleRelevance !== undefined && (
                          <div style={{ 
                            marginTop: "8px", 
                            fontSize: "0.75rem", 
                            color: "#6b7280" 
                          }}>
                            Title Relevance: {article.titleRelevance}/3
                            {article.impactScore !== null && article.impactScore !== undefined && (
                              <> | Impact Score: {article.impactScore}</>
                            )}
                          </div>
                        )}
                      </div>
                    </S.EnrichmentSection>
                  )}
                  
                  {enrichedArticle?.summary && (
                    <S.EnrichmentSection>
                      <S.SummaryText>
                        <strong>📝 Summary:</strong> {enrichedArticle.summary}
                      </S.SummaryText>
                    </S.EnrichmentSection>
                  )}
                  
                  <p>{article.description}</p>
                  
                  {enrichedArticle?.whyItMatters && (
                    <S.EnrichmentSection>
                      <S.WhyItMattersText>
                        <strong>💡 Why this matters:</strong> {enrichedArticle.whyItMatters}
                      </S.WhyItMattersText>
                    </S.EnrichmentSection>
                  )}
                  
                  {topRelevanceScores.length > 0 && (
                    <S.EnrichmentSection>
                      <S.RelevanceBadges>
                        {topRelevanceScores.map(([ticker, score]) => (
                          <S.RelevanceBadge key={ticker} $score={score}>
                            {ticker}: {score}%
                          </S.RelevanceBadge>
                        ))}
                      </S.RelevanceBadges>
                    </S.EnrichmentSection>
                  )}
                  
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    Read more
                  </a>
                </S.NewsCard>
              );
            })}
          </S.NewsGrid>
          <S.PaginationButtonsContainer>
            <S.PaginationButton
              disabled={currentPage === 1} // Disable "Previous" on first page
              onClick={handlePrevPage}
            >
              Previous
            </S.PaginationButton>
            <S.PaginationText>Page {currentPage}</S.PaginationText>
            <S.PaginationButton
              disabled={news.length === 0} // Disable "Next" when no more results
              onClick={handleNextPage}
            >
              Next
            </S.PaginationButton>
          </S.PaginationButtonsContainer>
        </>
      )}
    </S.Container>
  );
};

export default NewsAggregator;
