import React, { useState } from "react";
import axios from "axios";
import styled from "styled-components";

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

const BackButton = styled.button`
  background: #6b7280;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 24px;
  transition: all 0.2s;

  &:hover {
    background: #4b5563;
    transform: translateY(-2px);
  }
`;

const TestGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

const TestCard = styled.div`
  background-color: #fff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`;

const TestTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: #374151;
`;

const TestButton = styled.button<{ $loading?: boolean }>`
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: none;
  background: ${(props) => (props.$loading ? "#9ca3af" : "#2563eb")};
  color: white;
  font-weight: 600;
  cursor: ${(props) => (props.$loading ? "not-allowed" : "pointer")};
  transition: all 0.2s;
  margin-bottom: 8px;

  &:hover:not(:disabled) {
    background: #1d4ed8;
    transform: translateY(-2px);
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const ResultContainer = styled.div`
  background-color: #fff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 24px;
`;

const ResultTitle = styled.h2`
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 16px;
  color: #374151;
`;

const ResultContent = styled.pre`
  background-color: #1f2937;
  color: #f9fafb;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.875rem;
  line-height: 1.5;
  max-height: 600px;
  overflow-y: auto;
`;

const StatusBadge = styled.span<{ $status: number }>`
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-left: 8px;
  background-color: ${(props) => {
    if (props.$status >= 200 && props.$status < 300) return "#dcfce7";
    if (props.$status >= 400) return "#fee2e2";
    return "#fef3c7";
  }};
  color: ${(props) => {
    if (props.$status >= 200 && props.$status < 300) return "#166534";
    if (props.$status >= 400) return "#991b1b";
    return "#92400e";
  }};
`;

const getBackendUrl = () => {
  return process.env.NODE_ENV === "development"
    ? "http://localhost:5001"
    : process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
};

interface TestCase {
  name: string;
  url: string;
  description: string;
}

const testCases: TestCase[] = [
  {
    name: "Test 1: Basic Query (NVDA and AAPL)",
    url: "/api/articles?tickers=NVDA,AAPL&limit=10",
    description: "Returns articles that match NVDA or AAPL in the searched_by field",
  },
  {
    name: "Test 2: Query with Minimum Score Filter",
    url: "/api/articles?tickers=NVDA,AAPL&limit=10&minScore=40",
    description: "Returns only articles with relevance score >= 40",
  },
  {
    name: "Test 3: Query with Date Range",
    url: `/api/articles?tickers=NVDA&limit=5&from=${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}`,
    description: "Returns articles published in the last 7 days",
  },
  {
    name: "Test 4: Query with Source Filter (GNews only)",
    url: "/api/articles?tickers=NVDA&limit=5&sources=gnews",
    description: "Returns only articles from GNews source",
  },
  {
    name: "Test 5: Include Unprocessed Articles",
    url: "/api/articles?tickers=NVDA&limit=5&processedOnly=false",
    description: "Returns all articles (processed and unprocessed)",
  },
  {
    name: "Test 6: Error Case - Missing Tickers",
    url: "/api/articles?limit=10",
    description: "Should return 400 error for missing tickers parameter",
  },
  {
    name: "Test 7: Single Ticker Query",
    url: "/api/articles?tickers=NVDA&limit=5",
    description: "Returns articles matching NVDA only",
  },
  {
    name: "Test 8: Multiple Filters Combined",
    url: "/api/articles?tickers=NVDA,AAPL&limit=10&minScore=30&sources=gnews,newsapi&processedOnly=true",
    description: "Combines multiple filters: tickers, minScore, sources, and processedOnly",
  },
];

const ApiTestPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [loading, setLoading] = useState<{ [key: string]: boolean }>({});
  const [results, setResults] = useState<{ [key: string]: any }>({});
  const [selectedTest, setSelectedTest] = useState<string | null>(null);

  const runTest = async (testCase: TestCase) => {
    setLoading((prev) => ({ ...prev, [testCase.name]: true }));
    setSelectedTest(testCase.name);

    try {
      const response = await axios.get(`${getBackendUrl()}${testCase.url}`);
      setResults((prev) => ({
        ...prev,
        [testCase.name]: {
          status: response.status,
          data: response.data,
          success: true,
        },
      }));
    } catch (error: any) {
      setResults((prev) => ({
        ...prev,
        [testCase.name]: {
          status: error.response?.status || 0,
          data: error.response?.data || { error: error.message },
          success: false,
        },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [testCase.name]: false }));
    }
  };

  const runAllTests = async () => {
    for (const testCase of testCases) {
      await runTest(testCase);
      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  return (
    <Container>
      <BackButton onClick={onBack}>← Back to News</BackButton>
      <Title>🧪 API Test Cases - /api/articles Endpoint</Title>

      <div style={{ marginBottom: "16px", textAlign: "center" }}>
        <TestButton
          onClick={runAllTests}
          $loading={Object.values(loading).some((l) => l)}
          disabled={Object.values(loading).some((l) => l)}
          style={{ maxWidth: "300px", margin: "0 auto" }}
        >
          {Object.values(loading).some((l) => l) ? "⏳ Running Tests..." : "🚀 Run All Tests"}
        </TestButton>
      </div>

      <TestGrid>
        {testCases.map((testCase) => (
          <TestCard key={testCase.name}>
            <TestTitle>{testCase.name}</TestTitle>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "12px" }}>
              {testCase.description}
            </p>
            <TestButton
              onClick={() => runTest(testCase)}
              $loading={loading[testCase.name]}
              disabled={loading[testCase.name]}
            >
              {loading[testCase.name] ? "⏳ Running..." : "▶️ Run Test"}
            </TestButton>
            {results[testCase.name] && (
              <div style={{ marginTop: "8px" }}>
                <StatusBadge $status={results[testCase.name].status}>
                  {results[testCase.name].status} {results[testCase.name].success ? "✓" : "✗"}
                </StatusBadge>
                {results[testCase.name].data?.totalResults !== undefined && (
                  <span style={{ fontSize: "0.75rem", color: "#6b7280", marginLeft: "8px" }}>
                    {results[testCase.name].data.totalResults} results
                  </span>
                )}
              </div>
            )}
          </TestCard>
        ))}
      </TestGrid>

      {selectedTest && results[selectedTest] && (
        <ResultContainer>
          <ResultTitle>
            Results: {selectedTest}
            <StatusBadge $status={results[selectedTest].status}>
              Status {results[selectedTest].status}
            </StatusBadge>
          </ResultTitle>
          <ResultContent>
            {JSON.stringify(results[selectedTest].data, null, 2)}
          </ResultContent>
        </ResultContainer>
      )}
    </Container>
  );
};

export default ApiTestPage;






