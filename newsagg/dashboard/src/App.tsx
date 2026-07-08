import { Header } from "./components/Header";
import { SeekingAlphaPanel } from "./components/SeekingAlphaPanel";
import { SchwabStreamPanel } from "./components/SchwabStreamPanel";
import { CaptionSignalPanel } from "./components/CaptionSignalPanel";
import { XTickerPanel } from "./components/XTickerPanel";
import { RankingPanel } from "./components/RankingPanel";
import { usePoller } from "./lib/usePoller";

export default function App() {
  usePoller();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-term-bg text-term-text">
      <Header />

      {/* 3-column grid: 25% / 45% / 30%, each region scrolls on its own. */}
      <div className="grid min-h-0 flex-1 grid-cols-[25%_45%_30%] overflow-hidden">
        {/* Left column */}
        <div className="min-h-0 border-r border-term-border">
          <SeekingAlphaPanel />
        </div>

        {/* Middle column: stacked halves */}
        <div className="grid min-h-0 grid-rows-2 overflow-hidden border-r border-term-border">
          <div className="min-h-0 border-b border-term-border">
            <SchwabStreamPanel />
          </div>
          <div className="min-h-0">
            <CaptionSignalPanel />
          </div>
        </div>

        {/* Right column: stacked halves */}
        <div className="grid min-h-0 grid-rows-2 overflow-hidden">
          <div className="min-h-0 border-b border-term-border">
            <XTickerPanel />
          </div>
          <div className="min-h-0">
            <RankingPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
