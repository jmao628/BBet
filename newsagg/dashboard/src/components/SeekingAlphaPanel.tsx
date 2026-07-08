import { useStore, useWidgets } from "../store";
import { Panel, EmptyState } from "./Panel";
import type { WidgetRow } from "../types";

const NUM_RE = /^[0-5]\.\d{2}$/;

function Rating({ rating }: { rating: string | null }) {
  if (!rating) return null;
  if (NUM_RE.test(rating)) {
    return (
      <span className="rounded bg-term-up/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-term-up">
        {rating}
      </span>
    );
  }
  const strong = /strong/i.test(rating);
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        strong ? "bg-term-up/25 text-term-up" : "bg-term-up/15 text-term-up"
      }`}
    >
      {rating.toUpperCase()}
    </span>
  );
}

function Row({ row }: { row: WidgetRow }) {
  const setTicker = useStore((s) => s.setTicker);
  return (
    <div
      onClick={() => setTicker(row.ticker)}
      className="flex cursor-pointer items-center gap-2 border-b border-term-line px-3 py-1.5 hover:bg-white/[0.03]"
    >
      <span className="w-14 shrink-0 font-mono text-xs font-semibold text-term-accent">
        {row.ticker}
      </span>
      <div className="min-w-0 flex-1">
        {row.article ? (
          <>
            <div className="truncate text-xs text-term-text">{row.article}</div>
            {row.analyst && <div className="text-[10px] text-term-muted">{row.analyst}</div>}
          </>
        ) : (
          <div className="truncate text-xs text-term-muted">{row.company}</div>
        )}
      </div>
      <Rating rating={row.rating} />
    </div>
  );
}

export function SeekingAlphaPanel() {
  const widgets = useWidgets();

  return (
    <Panel title="SeekingAlpha Feed" accent="#f97316">
      {widgets.length === 0 ? (
        <EmptyState label="No SeekingAlpha data yet" hint="run the scraper to populate" />
      ) : (
        widgets.map((w) => (
          <div key={w.title}>
            <div className="sticky top-0 z-[1] bg-term-panel2 px-3 py-1.5 text-[11px] font-semibold text-term-text">
              {w.title}
            </div>
            {w.groups.map((g) => (
              <div key={g.label || w.title}>
                {g.label && (
                  <div className="bg-term-bg/40 px-3 py-1 text-[10px] uppercase tracking-wide text-term-muted">
                    {g.label}
                  </div>
                )}
                {g.rows.map((r, i) => (
                  <Row key={`${r.ticker}-${i}`} row={r} />
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </Panel>
  );
}
