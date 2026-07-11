import { useEffect, useMemo, useState } from "react";
import { useStore, useT, type ViewKey } from "../../store";
import {
  buildSeeds,
  buildRankings,
  buildScreen,
  buildFocus,
  noDataSet,
  sectorLabel,
  capLabel,
  type FocusItem,
} from "../pipeline";

// A dynamic "today's run" landing page: a synthesized snapshot + the actionable
// top picks + data freshness — deliberately NOT a repeat of the funnel nav.

function timeAgo(iso: string | null | undefined, t: (en: string, zh: string) => string): string {
  if (!iso) return t("never", "从未");
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return t("just now", "刚刚");
  if (m < 60) return t(`${m}m ago`, `${m} 分钟前`);
  const h = Math.round(m / 60);
  if (h < 24) return t(`${h}h ago`, `${h} 小时前`);
  return t(`${Math.round(h / 24)}d ago`, `${Math.round(h / 24)} 天前`);
}

function MiniSpark({ data, up }: { data: number[]; up: boolean }) {
  const W = 64;
  const H = 22;
  if (!data || data.length < 2) return <div style={{ width: W, height: H }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => `${((i * W) / (data.length - 1)).toFixed(1)},${(H - 2 - ((v - min) / rng) * (H - 4)).toFixed(1)}`);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#3dd6c4" : "#ff5a78"} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function OverviewView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const setView = useStore((s) => s.setView);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const noData = useMemo(() => noDataSet(technical), [technical]);
  const seeds = useMemo(() => buildSeeds(data).filter((r) => !noData.has(r.ticker)), [data, noData]);
  const advancing = useMemo(
    () => (heat || technical ? buildRankings(data, heat, technical, marketCaps).advancing.size : 0),
    [data, heat, technical, marketCaps],
  );
  const screenN = useMemo(
    () => (heat || technical ? buildScreen(data, heat, marketCaps, technical).candidates.length : 0),
    [data, heat, technical, marketCaps],
  );
  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const coreN = focus.filter((f) => f.core).length;
  const picks = focus.slice(0, 6);

  // top sectors among the graded focus list
  const sectorTop = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of focus) if (f.sector) m.set(f.sector, (m.get(f.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [focus]);
  const sectorMax = sectorTop[0]?.[1] ?? 1;

  // animate the funnel bars in on mount
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(id);
  }, []);

  const stages: { key: ViewKey; label: string; n: number; color: string }[] = [
    { key: "seeds", label: t("Seeds", "种子"), n: seeds.length, color: "#5a6a7c" },
    { key: "heat", label: t("Attention", "被关注"), n: advancing, color: "#5fb0e8" },
    { key: "screen", label: t("Quality", "质量"), n: screenN, color: "#3dd6c4" },
    { key: "focus", label: t("Focus", "重点"), n: focus.length, color: "#48c78e" },
    { key: "focus", label: t("★ Core", "★ 核心"), n: coreN, color: "#e9c46a" },
  ];
  const maxN = Math.max(1, ...stages.map((s) => s.n));

  const fresh = [
    { label: t("Seed scrape", "种子抓取"), iso: data?.generated_at },
    { label: t("Technical", "技术数据"), iso: technical?.generated_at },
    { label: t("Social heat", "社交热度"), iso: heat?.generated_at },
    { label: t("Ecosystem", "生态图"), iso: supplychain ? data?.generated_at : null },
  ];

  return (
    <div className="view-in space-y-5">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel2 p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle,#3dd6c4,transparent 70%)" }} />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle,#e9c46a,transparent 70%)" }} />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            {t("Discovery Run", "发现总览")}
            <span className="text-muted2">· {data?.generated_at?.slice(0, 10) ?? "—"}</span>
            <span className="flex items-center gap-1 text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> {t("LIVE", "实时")}
            </span>
          </div>
          <h1 className="font-disp text-[30px] font-semibold tracking-tight">
            {t("Today's Run", "当日运行")}
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
            {t("From ", "从 ")}
            <b className="text-text">{seeds.length}</b>
            {t(" bullish seeds, the machine graded ", " 只看多种子出发，机器筛出 ")}
            <b className="text-signal">{focus.length}</b>
            {t(" onto the Focus List and converged on ", " 只进入重点名单，并收敛出 ")}
            <b className="text-gold">{coreN}</b>
            {t(" ★ Core picks — buy + attention + ecosystem all aligned.", " 只 ★ 核心票（买入 + 被关注 + 生态 全部对齐）。")}
          </p>
        </div>
      </div>

      {/* ANIMATED FUNNEL FLOW */}
      <div className="rounded-2xl border border-line bg-panel2 p-5">
        <div className="mb-4 text-[13px] font-semibold text-muted">{t("The Funnel · today", "漏斗 · 当日收敛")}</div>
        <div className="space-y-2.5">
          {stages.map((s, i) => (
            <button
              key={i}
              onClick={() => setView(s.key)}
              className="group flex w-full items-center gap-3 text-left"
            >
              <span className="w-16 flex-none text-[12px] text-muted group-hover:text-text">{s.label}</span>
              <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-inset">
                <div
                  className="flex h-full items-center justify-end rounded-lg px-3 transition-[width] duration-[900ms] ease-out"
                  style={{
                    width: grown ? `${Math.max(6, (s.n / maxN) * 100)}%` : "0%",
                    background: `linear-gradient(90deg, ${s.color}22, ${s.color})`,
                    transitionDelay: `${i * 110}ms`,
                  }}
                >
                  <span className="font-mono text-[13px] font-semibold text-ink/90">{s.n}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* TOP PICKS + SIDE */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-line bg-panel2 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13px] font-semibold">{t("Today's Top Picks", "今日头号候选")}</div>
            <button onClick={() => setView("focus")} className="text-[12px] text-signal hover:underline">
              {t("Focus List →", "重点名单 →")}
            </button>
          </div>
          {picks.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted">
              {t("No picks yet — run technical + supplychain on the Mac.", "暂无候选——在 Mac 上跑 technical + supplychain。")}
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {picks.map((p, i) => (
                <PickRow key={p.ticker} p={p} rank={i} onOpen={openDetail} lang={lang} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* freshness */}
          <div className="rounded-2xl border border-line bg-panel2 p-5">
            <div className="mb-3 text-[13px] font-semibold">{t("Data Freshness", "数据新鲜度")}</div>
            <div className="space-y-2.5">
              {fresh.map((f) => {
                const stale = f.iso ? Date.now() - new Date(f.iso).getTime() > 36 * 3600e3 : true;
                return (
                  <div key={f.label} className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-2 text-muted">
                      <span className={`h-1.5 w-1.5 rounded-full ${f.iso ? (stale ? "bg-warn" : "animate-pulse bg-ok") : "bg-dead"}`} />
                      {f.label}
                    </span>
                    <span className="font-mono text-muted2">{timeAgo(f.iso, t)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* sector heat */}
          {sectorTop.length > 0 && (
            <div className="rounded-2xl border border-line bg-panel2 p-5">
              <div className="mb-3 text-[13px] font-semibold">{t("Where the Action Is", "热点板块")}</div>
              <div className="space-y-2">
                {sectorTop.map(([sec, n]) => (
                  <div key={sec} className="flex items-center gap-2 text-[12px]">
                    <span className="w-16 flex-none truncate text-muted">{sectorLabel(sec, lang)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-inset">
                      <div className="h-full rounded-full bg-signal/70 transition-all duration-700" style={{ width: grown ? `${(n / sectorMax) * 100}%` : "0%" }} />
                    </div>
                    <span className="w-6 flex-none text-right font-mono text-muted2">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PickRow({
  p,
  rank,
  onOpen,
  lang,
}: {
  p: FocusItem;
  rank: number;
  onOpen: (t: string) => void;
  lang: "en" | "zh";
}) {
  const up = (p.changePct ?? 0) >= 0;
  return (
    <button
      onClick={() => onOpen(p.ticker)}
      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-signal/40 hover:bg-white/[0.03]"
    >
      <span className="w-4 flex-none text-center font-mono text-[11px] text-muted2">{rank + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[14px] font-bold text-signal group-hover:underline">{p.ticker}</span>
          {p.core && <span className="text-[10px] text-gold">★</span>}
          <span className="font-mono text-[10px] text-muted2">{p.gates}/4</span>
        </div>
        <div className="truncate text-[10.5px] text-muted">
          {p.company || "—"}
          {p.sector ? ` · ${sectorLabel(p.sector, lang)}` : ""} · {capLabel(p.cap, lang)}
        </div>
      </div>
      <MiniSpark data={p.spark} up={up} />
      <div className="flex-none text-right">
        <div className="font-disp text-[16px] font-semibold" style={{ color: p.gates >= 3 ? "#3dd6c4" : "#c7d2dc" }}>
          {p.score}
        </div>
        {p.changePct != null && (
          <div className="font-mono text-[10px]" style={{ color: up ? "#48c78e" : "#ff5a78" }}>
            {up ? "+" : ""}
            {p.changePct.toFixed(1)}%
          </div>
        )}
      </div>
    </button>
  );
}
