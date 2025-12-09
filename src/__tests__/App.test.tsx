import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";

// Create a new QueryClient instance before each test to prevent cache issues
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Avoid retrying failed queries in tests
        staleTime: Infinity, // Prevent automatic refetching
      },
    },
  });

// Mock API response for react-query
jest.mock("../components/NewsAggregator", () => () => (
  <div>Mocked NewsAggregator Content</div>
));

describe("App Component", () => {
  test("renders the NewsAggregator component", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <App />
      </QueryClientProvider>
    );

    // Ensure an element from NewsAggregator is present
    expect(
      screen.getByText("Mocked NewsAggregator Content")
    ).toBeInTheDocument();
  });
});
