import { useMemo } from "react";
import { useStore, useWidgets } from "../store";
import { buildRanking } from "../lib/ranking";
import { Panel, EmptyState, ComingSoon } from "./Panel";

// Driven by the global ticker input in the header. The X/Ape-Wisdom mention
// feed isn't wired yet, so meanwhile we surface what we DO know about the
// typed ticker from the SeekingAlpha snapshot, so the input is useful now.
export function XTickerPanel() {
  const ticker = useStore((s) => s.ticker);
  const widgets = useWidgets();
  const row = useMemo(
    () => buildRanking(widgets).find((r) => r.ticker === ticker),
    [widgets, ticker],
  );

  return (
    <Panel
      title="X (Twitter) Ticker"
      accent="#e5e7eb"
      right={<ComingSoon source="Ape Wisdom" />}
    >
      {!ticker ? (
        <EmptyState label="Type a ticker in the header" hint="drives this panel" />
      ) : (
        <div className="p-3">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold text-term-accent">${ticker}</span>
            {row?.company && <span className="text-xs text-term-muted">{row.company}</span>}
          </div>

          <div className="rounded border border-dashed border-term-border p-3 text-center text-[11px] text-term-muted">
            Live X mention volume / sentiment for ${ticker} will stream here once
            the Ape Wisdom feed is connected.
          </div>

          {row && (
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-term-muted">
                From SeekingAlpha
              </div>
              {row.score != null && (
                <div className="flex justify-between">
                  <span className="text-term-muted">Best quant score</span>
                  <span className="font-mono font-semibold text-term-up">{row.score.toFixed(2)}</span>
                </div>
              )}
              {row.badges.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-term-muted">Analyst</span>
                  <span className="font-semibold text-term-up">{row.badges.join(", ")}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1">
                {row.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-term-panel2 px-1.5 py-0.5 text-[10px] text-term-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!row && (
            <div className="mt-3 text-[11px] text-term-muted">
              ${ticker} isn’t in today’s SeekingAlpha snapshot.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
