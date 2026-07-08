import { useMemo, useState } from "react";
import { useStore, useWidgets } from "../store";
import { buildRanking } from "../lib/ranking";
import { Panel, EmptyState } from "./Panel";
import type { RankRow } from "../types";

type SortKey = "score" | "ticker" | "sources";

export function RankingPanel() {
  const widgets = useWidgets();
  const ticker = useStore((s) => s.ticker);
  const setTicker = useStore((s) => s.setTicker);
  const [sort, setSort] = useState<SortKey>("score");

  const rows = useMemo(() => {
    const r = buildRanking(widgets);
    const sorted = [...r];
    if (sort === "ticker") sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
    else if (sort === "sources") sorted.sort((a, b) => b.tags.length - a.tags.length);
    // "score" keeps buildRanking's default (score desc).
    return sorted;
  }, [widgets, sort]);

  return (
    <Panel
      title="Stock Ranking"
      accent="#22c55e"
      right={<span className="text-[10px] text-term-muted">{rows.length} tickers</span>}
    >
      {rows.length === 0 ? (
        <EmptyState label="No ranking yet" hint="waiting for SeekingAlpha data" />
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-[1] bg-term-panel">
            <tr className="text-[10px] uppercase tracking-wide text-term-muted">
              <Th onClick={() => setSort("ticker")} active={sort === "ticker"}>
                Ticker
              </Th>
              <th className="px-2 py-1.5 text-left font-medium">Company</th>
              <Th onClick={() => setSort("score")} active={sort === "score"} right>
                Score
              </Th>
              <Th onClick={() => setSort("sources")} active={sort === "sources"} right>
                Src
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RankRowView
                key={r.ticker}
                row={r}
                selected={r.ticker === ticker}
                onSelect={() => setTicker(r.ticker)}
              />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Th({
  children,
  onClick,
  active,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  right?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-2 py-1.5 font-medium hover:text-term-text ${
        right ? "text-right" : "text-left"
      } ${active ? "text-term-accent" : ""}`}
    >
      {children}
      {active ? " ↓" : ""}
    </th>
  );
}

function RankRowView({
  row,
  selected,
  onSelect,
}: {
  row: RankRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer border-b border-term-line ${
        selected ? "bg-term-accent/15" : "hover:bg-white/[0.03]"
      }`}
    >
      <td className="px-2 py-1.5 font-mono font-semibold text-term-accent">{row.ticker}</td>
      <td className="max-w-0 truncate px-2 py-1.5 text-term-muted">{row.company}</td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
        {row.score != null ? (
          <span className="font-semibold text-term-up">{row.score.toFixed(2)}</span>
        ) : row.badges.length ? (
          <span className="text-[10px] font-semibold text-term-up">{row.badges[0]}</span>
        ) : (
          <span className="text-term-muted">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right text-term-muted">{row.tags.length}</td>
    </tr>
  );
}
