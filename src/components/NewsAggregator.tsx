import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import styled from "styled-components";
import HoldingsPanel from "./HoldingsPanel";
import TimeFilter, { TimeFilter as TimeFilterType } from "./TimeFilter";
import SourceFilter, { SourceFilter as SourceFilterType } from "./SourceFilter";
import { Article, EnrichedArticle, Holding } from "../types";

const Container = styled.div`
  min-height: 100vh;
  background-color: #f3f4f6;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
`;

const Title = styled.h1`
  font-size: 2rem;
  font-weight: bold;
  text-align: center;
  margin-bottom: 24px;
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
`;

const TabContainer = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
  gap: 8px;
`;

const TabButton = styled.button<{ $active?: boolean }>`
  padding: 12px 24px;
  border-radius: 8px;
  color: #fff;
  background-color: ${(props) => (props.$active ? "#2563eb" : "#6b7280")};
  cursor: pointer;
  transition: all 0.3s;
  font-weight: 600;
  font-size: 0.95rem;
  border: none;
  box-shadow: ${(props) => (props.$active ? "0 4px 8px rgba(37, 99, 235, 0.3)" : "0 2px 4px rgba(0, 0, 0, 0.1)")};

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#4b5563")};
    transform: translateY(-2px);
  }
`;

const ScrapeButton = styled.button<{ $bgColor?: string }>`
  background: ${(props) => props.$bgColor || "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"};
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const SourceCheckboxContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const SourceCheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  color: #374151;
  user-select: none;

  &:hover {
    color: #2563eb;
  }
`;

const SourceCheckbox = styled.input`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #2563eb;
`;

const SourceCheckboxText = styled.span`
  font-weight: 500;
`;

const Button = styled.button<{ $active?: boolean }>`
  padding: 8px 16px;
  margin: 0 8px;
  border-radius: 8px;
  color: #fff;
  background-color: ${(props) => (props.$active ? "#2563eb" : "#6b7280")};
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${(props) => (props.$active ? "#1d4ed8" : "#4b5563")};
  }
`;

const LoadingState = styled.p`
  text-align: center;
  color: #4b5563;
`;
const NewsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
`;

const NewsCard = styled.div`
  background-color: #fff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s, box-shadow 0.3s;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  img {
    width: 100%;
    height: 192px;
    object-fit: cover;
    border-radius: 8px;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: bold;
    margin-top: 8px;
  }

  p {
    color: #4b5563;
    font-size: 0.875rem;
    margin-top: 4px;
  }

  a {
    display: block;
    margin-top: 16px;
    color: #2563eb;
    font-weight: bold;
    text-decoration: none;

    &:hover {
      color: #1d4ed8;
    }
  }
`;

const ArticleMeta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
  gap: 8px;
`;

const PublicationDate = styled.span`
  color: #6b7280;
  font-size: 0.75rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const FeedSourceBadge = styled.span<{ $source: string }>`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  background-color: ${(props) => {
    if (props.$source === "gnews") return "#e0f2fe"; // Light blue for GNews
    if (props.$source === "newsapi") return "#fef3c7"; // Light yellow for NewsAPI
    return "#f3f4f6"; // Gray for unknown
  }};
  color: ${(props) => {
    if (props.$source === "gnews") return "#0369a1"; // Dark blue
    if (props.$source === "newsapi") return "#92400e"; // Dark yellow/brown
    return "#6b7280"; // Gray
  }};
  border: 1px solid ${(props) => {
    if (props.$source === "gnews") return "#7dd3fc";
    if (props.$source === "newsapi") return "#fde047";
    return "#e5e7eb";
  }};
`;

const EnrichmentSection = styled.div`
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
`;

const SummaryText = styled.p`
  color: #374151;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0;
  font-style: italic;
`;

const WhyItMattersText = styled.p`
  color: #1f2937;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 8px 0;
  font-weight: 500;
`;

const RelevanceBadges = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

const RelevanceBadge = styled.span<{ $score: number }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => {
    if (props.$score >= 70) return "#dcfce7"; // Green for high relevance
    if (props.$score >= 40) return "#fef3c7"; // Yellow for medium relevance
    return "#f3f4f6"; // Gray for low relevance
  }};
  color: ${(props) => {
    if (props.$score >= 70) return "#166534";
    if (props.$score >= 40) return "#92400e";
    return "#6b7280";
  }};
  border: 1px solid ${(props) => {
    if (props.$score >= 70) return "#86efac";
    if (props.$score >= 40) return "#fde047";
    return "#e5e7eb";
  }};
`;

const ToggleContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
`;

const ToggleLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
`;

const ToggleSwitch = styled.input`
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background-color: #9ca3af;
  appearance: none;
  position: relative;
  cursor: pointer;
  transition: background-color 0.3s;

  &:checked {
    background-color: #2563eb;
  }

  &:before {
    content: "";
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: #fff;
    top: 2px;
    left: 2px;
    transition: transform 0.3s;
  }

  &:checked:before {
    transform: translateX(20px);
  }
`;

const PaginationButtonsContainer = styled.div`
  text-align: center;
  margin-top: 20px;
`;

const PaginationButton = styled.button<{ disabled: boolean }>`
  padding: 8px 16px;
  margin-right: 10px;
  border-radius: 5px;
  border: none;
  background: #2563eb;
  color: #fff;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.disabled ? 0.5 : 1)};
`;

const PaginationText = styled.span`
  margin: 0px 10px;
`;

const SearchContainer = styled.div`
  text-align: center;
  margin-bottom: 16px;
`;

const SearchBox = styled.input`
  padding: 10px;
  width: 100%;
  max-width: 500px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  outline: none;
  transition: border-color 0.3s;

  &:focus {
    border-color: #2563eb;
  }
`;

// Format publication date to readable format
const formatPublishedDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    // Less than a minute ago
    if (diffInSeconds < 60) {
      return "Just now";
    }

    // Less than an hour ago
    if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    }

    // Less than 24 hours ago
    if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    }

    // Less than 7 days ago
    if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} ${days === 1 ? "day" : "days"} ago`;
    }

    // More than a week ago - show formatted date
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    };
    return date.toLocaleDateString("en-US", options);
  } catch (error) {
    return "Unknown date";
  }
};

const getBackendUrl = () => {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:5001"
    : process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
};

const fetchNews = async ({
  queryKey,
}: {
  queryKey: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean, string[]];
}) => {
  const [, viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdings, shouldScrape, selectedSources] = queryKey;
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

      const url = `${BACKEND_URL}/api/news?${params.toString()}`;
      const response = await axios.get(url);
      return response.data.articles || [];
};

type ViewMode = "all" | "feed";

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
  const [triageLoading, setTriageLoading] = useState<boolean>(false);
  const [enrichLoading, setEnrichLoading] = useState<boolean>(false);
  const [clearLoading, setClearLoading] = useState<boolean>(false);
  const [pipelineLoading, setPipelineLoading] = useState<boolean>(false);
  const [rankingLoading, setRankingLoading] = useState<boolean>(false);
  const [stepMessage, setStepMessage] = useState<string>("");

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
    queryKey: ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, shouldScrape, selectedSources],
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
      localStorage.setItem("newsCategory", newCategory);
      localStorage.setItem("newsPage", "1");
    }
  };

  const handleTimeFilterChange = (filter: TimeFilterType) => {
    setTimeFilter(filter);
    setCurrentPage(1); // Reset to first page when filter changes
    setShouldScrape(false); // Always use cached articles when filters change
    localStorage.setItem("wealthyRabbitTimeFilter", JSON.stringify(filter));
    localStorage.setItem("newsPage", "1");
  };

  const handleSourceFilterChange = (filter: SourceFilterType) => {
    setSourceFilter(filter);
    setCurrentPage(1); // Reset to first page when filter changes
    setShouldScrape(false); // Always use cached articles when filters change
    localStorage.setItem("wealthyRabbitSourceFilter", JSON.stringify(filter));
    localStorage.setItem("newsPage", "1");
  };

  const handleEnrichedToggle = (enabled: boolean) => {
    setUseEnriched(enabled);
    setCurrentPage(1); // Reset to first page when mode changes
    setShouldScrape(false); // Always use cached articles when mode changes
    localStorage.setItem("wealthyRabbitUseEnriched", enabled.toString());
    localStorage.setItem("newsPage", "1");
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setShouldScrape(false); // Always use cached articles when search changes
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

  // Handle triage step
  const handleTriageStep = async () => {
    setTriageLoading(true);
    setStepMessage("");
    try {
      const response = await axios.post(`${getBackendUrl()}/api/enrichment/triage`, {
        holdings: holdingsTickers,
        from: timeFilter.fromDate || undefined,
        to: timeFilter.toDate || undefined,
        sources: sourceFilter.sources && sourceFilter.sources.length > 0 ? sourceFilter.sources : undefined,
      });
      setStepMessage(`✅ Triage complete: ${response.data.triaged} articles analyzed, ${response.data.toEnrich} to enrich, ${response.data.filtered} filtered out`);
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error: any) {
      setStepMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setTriageLoading(false);
    }
  };

  // Handle enrichment step
  const handleEnrichStep = async () => {
    setEnrichLoading(true);
    setStepMessage("");
    try {
      const response = await axios.post(`${getBackendUrl()}/api/enrichment/enrich`, {
        holdings: holdingsTickers,
        from: timeFilter.fromDate || undefined,
        to: timeFilter.toDate || undefined,
        sources: sourceFilter.sources && sourceFilter.sources.length > 0 ? sourceFilter.sources : undefined,
      });
      setStepMessage(`✅ Enrichment complete: ${response.data.enriched} articles enriched out of ${response.data.total}`);
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error: any) {
      setStepMessage(`❌ Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setEnrichLoading(false);
    }
  };

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
      const response = await axios.post(`${getBackendUrl()}/api/articles/process`, {
        holdings: holdingsTickers, // Backend expects array of ticker strings
        userProfile: "balanced",
      });
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
      const response = await axios.post(`${getBackendUrl()}/api/articles/rank`, {
        cutoffScore: 50,
      });
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

  return (
    <Container>
      <Title>🐰 Wealthy Rabbit</Title>
      <HoldingsPanel />
      <TabContainer>
        <TabButton $active={viewMode === "all"} onClick={() => handleViewModeChange("all")}>
          📰 All News
        </TabButton>
        <TabButton $active={viewMode === "feed"} onClick={() => handleViewModeChange("feed")}>
          ⭐ My Feed
        </TabButton>
      </TabContainer>
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
      {viewMode === "all" && (
        <SearchContainer>
        <SearchBox
          type="text"
          placeholder="Search for news..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        </SearchContainer>
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
      {viewMode === "all" && (
        <>
          <SourceCheckboxContainer>
            <span style={{ fontWeight: 600, color: "#374151", marginRight: "8px" }}>Scrape from:</span>
            <SourceCheckboxLabel>
              <SourceCheckbox
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
              <SourceCheckboxText>NewsAPI</SourceCheckboxText>
            </SourceCheckboxLabel>
            <SourceCheckboxLabel>
              <SourceCheckbox
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
              <SourceCheckboxText>GNews</SourceCheckboxText>
            </SourceCheckboxLabel>
            <SourceCheckboxLabel>
              <SourceCheckbox
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
              <SourceCheckboxText>Google RSS</SourceCheckboxText>
            </SourceCheckboxLabel>
          </SourceCheckboxContainer>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            <ScrapeButton
              onClick={async () => {
                console.log("[ScrapeButton] Clicked - directly calling API with scrape=true");
                console.log("[ScrapeButton] Selected sources:", selectedSources);
                
                // Ensure at least one source is selected
                if (selectedSources.length === 0) {
                  alert("Please select at least one source to scrape from.");
                  return;
                }
                
                try {
                  const BACKEND_URL = getBackendUrl();
                  let response;
                  
                  // If user has holdings, ALWAYS use enriched endpoint (even if toggle is off)
                  // This ensures holdings are taken into account when scraping
                  if (holdingsTickers.length > 0) {
                    // Enriched news endpoint - uses holdings to search
                    console.log(`[ScrapeButton] Scraping enriched news for holdings: ${holdingsTickers.join(', ')}`);
                    response = await axios.post(`${BACKEND_URL}/api/news/holdings/enriched`, {
                      holdings: holdingsTickers,
                      page: currentPage,
                      from: timeFilter.fromDate || undefined,
                      to: timeFilter.toDate || undefined,
                      sources: selectedSources.length > 0 ? selectedSources : undefined,
                      scrape: true, // Force scrape
                    });
                  } else {
                    // Regular news endpoint - only if no holdings
                    console.log(`[ScrapeButton] Scraping regular news for category: ${category} (no holdings)`);
                    const params = new URLSearchParams();
                    params.append("category", category);
                    params.append("page", currentPage.toString());
                    params.append("scrape", "true");
                    if (timeFilter.fromDate) params.append("from", timeFilter.fromDate);
                    if (timeFilter.toDate) params.append("to", timeFilter.toDate);
                    if (selectedSources.length > 0) {
                      params.append("sources", selectedSources.join(','));
                    }
                    
                    response = await axios.get(`${BACKEND_URL}/api/news?${params.toString()}`);
                  }
                
                console.log(`[ScrapeButton] Direct API call successful, received ${response.data.articles?.length || 0} articles`);
                console.log(`[ScrapeButton] Response cached flag: ${response.data.cached}, articles sample:`, response.data.articles?.slice(0, 3).map((a: any) => ({ title: a.title?.substring(0, 50), url: a.url })));
                
                // Check if we got new articles or same ones
                const articleUrls = (response.data.articles || []).map((a: any) => a.url);
                const uniqueUrls = new Set(articleUrls);
                console.log(`[ScrapeButton] Total articles: ${articleUrls.length}, Unique URLs: ${uniqueUrls.size}`);
                
                // Update the query cache with the new data for BOTH scrape=true and scrape=false queryKeys
                const queryKeyWithScrape: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean] = 
                  ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, true];
                const queryKeyNoScrape: [string, ViewMode, string, string, number, TimeFilterType, SourceFilterType, boolean, string[], boolean] = 
                  ["news", viewMode, category, searchTerm, currentPage, timeFilter, sourceFilter, useEnriched, holdingsTickers, false];
                
                // Set data in both caches so UI updates regardless of which queryKey is active
                queryClient.setQueryData(queryKeyWithScrape, response.data.articles || []);
                queryClient.setQueryData(queryKeyNoScrape, response.data.articles || []);
                
                // Set shouldScrape to true to trigger scrape
                setShouldScrape(true);
                
                // Invalidate all news queries to force UI refresh
                // The useEffect will reset shouldScrape after successful fetch
                await queryClient.invalidateQueries({ queryKey: ["news"] });
              } catch (error: any) {
                console.error("[ScrapeButton] Error scraping articles:", error);
                alert(`Error scraping articles: ${error.response?.data?.error || error.message}`);
              }
            }}
            disabled={loading}
          >
            {loading ? "⏳ Scraping..." : "🔄 Scrape New Articles"}
          </ScrapeButton>
          {!loading && news.length > 0 && (
            <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              Showing {news.length} cached article{news.length !== 1 ? "s" : ""}. Click "Scrape" to fetch new ones.
            </span>
          )}
        </div>
        </>
      )}
      {holdings.length > 0 && useEnriched && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap", padding: "12px", backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)" }}>
            <ScrapeButton
              onClick={handleTriageStep}
              disabled={triageLoading || enrichLoading || clearLoading || pipelineLoading || rankingLoading}
              $bgColor="#10b981"
            >
              {triageLoading ? "⏳ Triaging..." : "🔍 Step 1: Triage Articles"}
            </ScrapeButton>
            <ScrapeButton
              onClick={handleEnrichStep}
              disabled={triageLoading || enrichLoading || clearLoading || pipelineLoading || rankingLoading}
              $bgColor="#3b82f6"
            >
              {enrichLoading ? "⏳ Enriching..." : "✨ Step 2: Enrich Articles"}
            </ScrapeButton>
            <ScrapeButton
              onClick={handleClearDatabase}
              disabled={triageLoading || enrichLoading || clearLoading || pipelineLoading || rankingLoading}
              $bgColor="#ef4444"
            >
              {clearLoading ? "⏳ Clearing..." : "🗑️ Clear Database"}
            </ScrapeButton>
            {stepMessage && (
              <span style={{ color: stepMessage.includes("✅") ? "#10b981" : "#ef4444", fontSize: "0.875rem", marginLeft: "8px" }}>
                {stepMessage}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap", padding: "12px", backgroundColor: "#f0f9ff", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)", border: "1px solid #bae6fd" }}>
            <div style={{ width: "100%", marginBottom: "8px", fontSize: "0.875rem", fontWeight: "600", color: "#0369a1" }}>
              🔄 Full Pipeline Processing (5 Stages)
            </div>
            <ScrapeButton
              onClick={handlePipelineProcess}
              disabled={triageLoading || enrichLoading || clearLoading || pipelineLoading || rankingLoading}
              $bgColor="#8b5cf6"
            >
              {pipelineLoading ? "⏳ Processing..." : "🚀 Run Full Pipeline (Stages 1-4)"}
            </ScrapeButton>
            <ScrapeButton
              onClick={handleRanking}
              disabled={triageLoading || enrichLoading || clearLoading || pipelineLoading || rankingLoading}
              $bgColor="#f59e0b"
            >
              {rankingLoading ? "⏳ Ranking..." : "📊 Stage 5: Ranking & Clustering"}
            </ScrapeButton>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "8px" }}>
              Pipeline processes: Title Triage → Content Fetch → Classification → Personalization → Ranking
            </div>
          </div>
        </>
      )}
      {viewMode === "all" && (
        <ButtonGroup>
          {[
            "business",
            "technology",
            "general",
          ].map((cat) => (
            <Button
              key={cat}
              onClick={() => handleCategoryButtonClick(cat)}
              $active={category === cat}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Button>
          ))}
        </ButtonGroup>
      )}
      {error ? (
        <LoadingState style={{ padding: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b" }}>
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
        </LoadingState>
      ) : loading ? (
        <LoadingState>Loading news...</LoadingState>
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
          <NewsGrid>
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
                <NewsCard key={`${article.url}-${index}`}>
                  {article.urlToImage && (
                    <img src={article.urlToImage} alt={article.title} />
                  )}
                  <h2>{article.title}</h2>
                  <ArticleMeta>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <p style={{ margin: 0 }}>{article.source.name}</p>
                      {article.feedSource && (
                        <FeedSourceBadge $source={article.feedSource}>
                          {article.feedSource === "gnews" ? "📰 GNews" : article.feedSource === "newsapi" ? "📡 NewsAPI" : article.feedSource}
                        </FeedSourceBadge>
                      )}
                    </div>
                    {article.publishedAt && (
                      <PublicationDate>
                        🕐 {formatPublishedDate(article.publishedAt)}
                      </PublicationDate>
                    )}
                  </ArticleMeta>
                  
                  {enrichedArticle?.summary && (
                    <EnrichmentSection>
                      <SummaryText>
                        <strong>📝 Summary:</strong> {enrichedArticle.summary}
                      </SummaryText>
                    </EnrichmentSection>
                  )}
                  
                  <p>{article.description}</p>
                  
                  {enrichedArticle?.whyItMatters && (
                    <EnrichmentSection>
                      <WhyItMattersText>
                        <strong>💡 Why this matters:</strong> {enrichedArticle.whyItMatters}
                      </WhyItMattersText>
                    </EnrichmentSection>
                  )}
                  
                  {topRelevanceScores.length > 0 && (
                    <EnrichmentSection>
                      <RelevanceBadges>
                        {topRelevanceScores.map(([ticker, score]) => (
                          <RelevanceBadge key={ticker} $score={score}>
                            {ticker}: {score}%
                          </RelevanceBadge>
                        ))}
                      </RelevanceBadges>
                    </EnrichmentSection>
                  )}
                  
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    Read more
                  </a>
                </NewsCard>
              );
            })}
          </NewsGrid>
          <PaginationButtonsContainer>
            <PaginationButton
              disabled={currentPage === 1} // Disable "Previous" on first page
              onClick={handlePrevPage}
            >
              Previous
            </PaginationButton>
            <PaginationText>Page {currentPage}</PaginationText>
            <PaginationButton
              disabled={news.length === 0} // Disable "Next" when no more results
              onClick={handleNextPage}
            >
              Next
            </PaginationButton>
          </PaginationButtonsContainer>
        </>
      )}
    </Container>
  );
};

export default NewsAggregator;
