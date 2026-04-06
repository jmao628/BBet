import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/shared/Layout";
import TerminalPage from "./pages/TerminalPage";
import HomePage from "./pages/HomePage";
import MarketPage from "./pages/MarketPage";
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
            <Route path="/" element={<TerminalPage />} />
            <Route path="/portfolio" element={<HomePage />} />
            <Route path="/game/:gameId" element={<MarketPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/game-detail/:gameId" element={<GameDetailPage />} />
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
