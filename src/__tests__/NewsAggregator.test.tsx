import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewsAggregator from "../components/NewsAggregator";
import axios from "axios";

jest.mock("axios", () => ({
  get: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const queryClient = new QueryClient();

describe("NewsAggregator Component", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const mockNews = [
    {
      source: { name: "Test Source" },
      title: "Test Article",
      description: "This is a test article description.",
      url: "https://example.com",
      urlToImage: "https://example.com/image.jpg",
    },
  ];

  it("renders the NewsAggregator component", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );
    expect(screen.getByText("🐰 Wealthy Rabbit")).toBeInTheDocument();
  });

  it("fetches and displays news articles", async () => {
    mockedAxios.get.mockResolvedValue({ data: { articles: mockNews } });

    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Test Article")).toBeInTheDocument();
    });
  });

  it("changes category on button click", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );

    const businessButton = screen.getByText("Business");
    fireEvent.click(businessButton);

    await waitFor(() => {
      expect(localStorage.getItem("newsCategory")).toBe("business");
    });
  });

  it("updates search term on input change", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );

    const searchInput = screen.getByPlaceholderText("Search for news...");
    fireEvent.change(searchInput, { target: { value: "React" } });

    await waitFor(() => {
      expect(localStorage.getItem("newsSearch")).toBe("React");
    });
  });

  it("handles pagination correctly", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );

    const nextButton = screen.getByText("Next");
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(localStorage.getItem("newsPage")).toBe("2");
    });
  });

  it("disables previous button on first page", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewsAggregator />
      </QueryClientProvider>
    );

    const prevButton = screen.getByText("Previous");
    expect(prevButton).toBeDisabled();
  });
});
