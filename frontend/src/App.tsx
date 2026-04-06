import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/shared/Layout";
import DashboardPage from "./pages/DashboardPage";
import GameDetailPage from "./pages/GameDetailPage";
import SignalsPage from "./pages/SignalsPage";
import BacktestPage from "./pages/BacktestPage";
import RiskPage from "./pages/RiskPage";
import SystemPage from "./pages/SystemPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/game/:gameId" element={<GameDetailPage />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/risk" element={<RiskPage />} />
            <Route path="/system" element={<SystemPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
