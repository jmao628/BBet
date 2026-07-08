import { useEffect, useState } from "react";
import { useStore, type ConnStatus } from "../store";

const STATUS_META: Record<ConnStatus, { label: string; color: string }> = {
  connecting: { label: "CONNECTING", color: "#eab308" },
  live: { label: "LIVE", color: "#22c55e" },
  stale: { label: "STALE", color: "#f97316" },
  error: { label: "NO DATA", color: "#ef4444" },
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Header() {
  const now = useClock();
  const status = useStore((s) => s.status);
  const lastUpdated = useStore((s) => s.lastUpdated);
  const generatedAt = useStore((s) => s.data?.generated_at ?? null);
  const ticker = useStore((s) => s.ticker);
  const setTicker = useStore((s) => s.setTicker);
  const meta = STATUS_META[status];

  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-term-border bg-term-panel px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold tracking-tight text-term-text">◨ TRADING MONITOR</span>
        <span
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="TICKER →"
          spellCheck={false}
          className="w-32 rounded border border-term-border bg-term-bg px-2 py-1 font-mono text-xs uppercase text-term-text placeholder:text-term-muted focus:border-term-accent focus:outline-none"
        />
        <div className="flex flex-col items-end leading-tight">
          <span className="font-mono text-sm tabular-nums text-term-text">
            {now.toLocaleTimeString([], { hour12: false })}
          </span>
          <span className="text-[10px] text-term-muted">
            {generatedAt
              ? `data ${new Date(generatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
              : lastUpdated
                ? "—"
                : "loading…"}
          </span>
        </div>
      </div>
    </header>
  );
}
