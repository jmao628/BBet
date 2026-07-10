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
  const setView = useStore((s) => s.setView);
  const openDetail = useStore((s) => s.openDetail);
  const closeDetail = useStore((s) => s.closeDetail);
  const meta = STATUS[status];

  const goHome = () => {
    closeDetail();
    setView("overview");
  };
  const submitSearch = () => {
    const t = ticker.trim();
    if (t) openDetail(t);
  };

  const runDate = generatedAt
    ? new Date(generatedAt).toLocaleDateString("en-CA")
    : now.toLocaleDateString("en-CA");

  return (
    <div className="col-span-2 flex items-center gap-4 border-b border-line bg-[linear-gradient(180deg,#0E141D,#0A0E15)] px-5">
      <button
        onClick={goHome}
        title="回到发现总览"
        className="-ml-1 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/[0.04]"
      >
        <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] border border-signal/25 bg-[linear-gradient(145deg,rgba(61,214,196,0.16),rgba(61,214,196,0.02))]">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#3dd6c4"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 16.5 L9.5 10.5 L13.5 14.5 L20 7" />
            <path d="M14.5 7 L20 7 L20 12.5" />
          </svg>
        </span>
        <div className="text-left leading-none">
          <div className="font-disp text-[16px] font-semibold tracking-[0.24em] text-text">
            MIDEA
          </div>
          <div className="mt-1 text-[9.5px] uppercase tracking-[0.13em] text-muted2">
            共识修正定时机器
          </div>
        </div>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 focus-within:border-signal/50">
        <span className="text-muted2">⌕</span>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitSearch()}
          placeholder="搜代码 ↵"
          spellCheck={false}
          className="w-28 bg-transparent font-mono text-[13px] uppercase text-text outline-none placeholder:normal-case placeholder:text-muted2"
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
