import { useEffect, useState } from "react";
import { useStore, type ConnStatus } from "../store";

const STATUS: Record<ConnStatus, { label: string; color: string }> = {
  connecting: { label: "CONNECTING", color: "#e7b84c" },
  live: { label: "LIVE", color: "#5bc48c" },
  stale: { label: "STALE", color: "#f2a73c" },
  error: { label: "NO DATA", color: "#e5636b" },
};

export function TopBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = useStore((s) => s.status);
  const generatedAt = useStore((s) => s.data?.generated_at ?? null);
  const ticker = useStore((s) => s.ticker);
  const setTicker = useStore((s) => s.setTicker);
  const meta = STATUS[status];

  const runDate = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-CA")
    : now.toLocaleDateString("en-CA");

  return (
    <div className="col-span-2 flex items-center gap-4 border-b border-line bg-[linear-gradient(180deg,#0E141D,#0A0E15)] px-5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-signal/15 text-signal">
          ◨
        </span>
        <div className="leading-none">
          <div className="font-disp text-[16px] font-bold tracking-tight">
            Super<span className="text-signal">Beta</span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted2">
            共识修正定时机器
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5">
        <span className="text-muted2">⌕</span>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="TICKER"
          spellCheck={false}
          className="w-24 bg-transparent font-mono text-[13px] uppercase text-text outline-none placeholder:text-muted2"
        />
      </div>

      <div className="rounded-md border border-line bg-panel2 px-2.5 py-1.5 font-mono text-[12px] text-muted">
        RUN <b className="text-text">{runDate}</b>
      </div>

      <div
        className="flex items-center gap-1.5 font-mono text-[11px] font-semibold"
        style={{ color: meta.color }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
        {meta.label}
        <span className="ml-1 tabular-nums text-muted">{now.toLocaleTimeString([], { hour12: false })}</span>
      </div>
    </div>
  );
}
