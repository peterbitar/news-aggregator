import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import NewsAggregator from "./components/NewsAggregator";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NewsAggregator />
      <ReactQueryDevtools initialIsOpen={false} /> {/* ✅ Adds DevTools */}
    </QueryClientProvider>
  );
}

export default App;
