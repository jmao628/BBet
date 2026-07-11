import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import {
  buildFocus,
  capLabel,
  sectorLabel,
  SUSTAINED_DAYS,
  FOCUS_ATTN_BAR,
  FOCUS_RVOL_BAR,
  type FocusItem,
} from "../pipeline";
import { ViewHead, StatStrip } from "../ui";
import { MethodInfo } from "../MethodInfo";

const GRP_COLOR: Record<string, string> = {
  upstream: "#5fb0e8",
  downstream: "#48c78e",
  peers: "#e9c46a",
};

type FilterKey = "all" | "core" | "both" | "strong" | "sustained" | "linked";
type SortKey = "score" | "attn" | "links" | "rvol" | "streak";

export function FocusView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [sector, setSector] = useState<string | null>(null);

  const all = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );

  const coreN = all.filter((i) => i.tier === 1).length;
  const bothN = all.filter((i) => i.strongBuy && i.links > 0).length;
  const strongN = all.filter((i) => i.strongBuy).length;
  const sustainedN = all.filter((i) => i.buyStreak >= SUSTAINED_DAYS).length;
  const linkedN = all.filter((i) => i.links > 0).length;

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of all) if (i.sector) m.set(i.sector, (m.get(i.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const shown = useMemo(() => {
    let rows = all;
    if (filter === "core") rows = rows.filter((i) => i.tier === 1);
    else if (filter === "both") rows = rows.filter((i) => i.strongBuy && i.links > 0);
    else if (filter === "strong") rows = rows.filter((i) => i.strongBuy);
    else if (filter === "sustained") rows = rows.filter((i) => i.buyStreak >= SUSTAINED_DAYS);
    else if (filter === "linked") rows = rows.filter((i) => i.links > 0);
    if (sector) rows = rows.filter((i) => i.sector === sector);
    const key = (i: FocusItem) =>
      sort === "attn"
        ? (i.attnScore ?? -1)
        : sort === "links"
          ? i.links
          : sort === "rvol"
            ? (i.rvol ?? -1)
            : sort === "streak"
              ? i.buyStreak
              : i.score;
    return [...rows].sort((a, b) => key(b) - key(a) || b.score - a.score);
  }, [all, filter, sector, sort]);

  const FILTERS: { k: FilterKey; label: string; n: number }[] = [
    { k: "all", label: t("All", "全部"), n: all.length },
    { k: "core", label: t("★ Core", "★ 核心"), n: coreN },
    { k: "both", label: t("Strong × Linked", "强买×关联"), n: bothN },
    { k: "strong", label: t("Strong Buy", "强力买入"), n: strongN },
    { k: "sustained", label: t(`Sustained ${SUSTAINED_DAYS}d`, `持续买入 ${SUSTAINED_DAYS} 天`), n: sustainedN },
    { k: "linked", label: t("Connected", "有关联"), n: linkedN },
  ];
  const SORTS: { k: SortKey; label: string }[] = [
    { k: "score", label: t("Composite", "综合分") },
    { k: "streak", label: t("Buy streak", "买入连续") },
    { k: "attn", label: t("Attention", "注意力") },
    { k: "links", label: t("Links", "关联数") },
    { k: "rvol", label: "RVOL" },
  ];

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Step 2 · Output", "第 2 步 · 输出")}
        title={t("Focus List · The Strict Shortlist", "重点名单 · 严格短名单")}
        desc={t(
          `Not a union — a strict AND gate. A name makes the list only if it clears all three: BUY (gauge strong-buy or a ${SUSTAINED_DAYS}-day sustained buy) · ATTENTION (price-volume attention ≥${FOCUS_ATTN_BAR} or RVOL ≥${FOCUS_RVOL_BAR}) · BACKED (an analyst thesis + rating, or tied to a mega-cap anchor). ★ Core = everything aligned (strong-buy + sustained + in both nets + anchored). Every new ticker that flows in is judged by the same rule automatically.`,
          `不是并集,是严格的三闸 AND。一只票必须同时过三关才入选：买入(表针强买 或 连续${SUSTAINED_DAYS}天买入) · 被关注(量价注意力≥${FOCUS_ATTN_BAR} 或 RVOL≥${FOCUS_RVOL_BAR}) · 有依据(有分析师论点+评分 或 挂靠大票锚)。★ 核心 = 全部对齐(强买+持续+两网交集+有锚)。以后任何新流入的票都按同一规则自动判定。`,
        )}
        actions={<MethodInfo />}
      />

      <StatStrip
        stats={[
          { k: t("On the list", "名单内"), v: all.length, d: t("cleared all 3 gates", "三闸全过"), color: "#3dd6c4" },
          { k: t("★ Core", "★ 核心"), v: coreN, d: t("everything aligned", "全部对齐"), color: "#f2a73c" },
          { k: t("Strong Buy", "强力买入"), v: strongN, d: t("gauge = strong buy", "表针=强买") },
          { k: t(`Sustained ${SUSTAINED_DAYS}d`, `持续买入 ${SUSTAINED_DAYS}天`), v: sustainedN, d: t("buy ≥5 days running", "连续≥5天买入"), color: "#48c78e" },
        ]}
      />

      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                filter === f.k ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
              }`}
            >
              {f.label} <span className="font-mono text-[11px] opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted2">{t("Sort", "排序")}</span>
          {SORTS.map((s) => (
            <button
              key={s.k}
              onClick={() => setSort(s.k)}
              className={`rounded-md px-2 py-0.5 text-[12px] transition-colors ${
                sort === s.k ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {sectorCounts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted2">{t("Sector:", "板块:")}</span>
          <button
            onClick={() => setSector(null)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
              sector === null ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
            }`}
          >
            {t("All", "全部")}
          </button>
          {sectorCounts.map(([sec, n]) => (
            <button
              key={sec}
              onClick={() => setSector(sector === sec ? null : sec)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                sector === sec ? "border-signal/50 bg-signal/10 text-signal" : "border-line text-muted hover:text-text"
              }`}
            >
              {sectorLabel(sec, lang)} {n}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t(
            "Nothing here yet — needs technical data (strong-buy gauges) and supply-chain maps. Run technical + supplychain on the Mac.",
            "暂时为空——需要技术数据(强买表针)和供应链映射。在 Mac 上跑 technical + supplychain。",
          )}
        </div>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {shown.map((i, idx) => (
            <FocusCard key={i.ticker} item={i} rank={idx} onOpen={openDetail} lang={lang} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function FocusCard({
  item,
  rank,
  onOpen,
  lang,
  t,
}: {
  item: FocusItem;
  rank: number;
  onOpen: (t: string) => void;
  lang: "en" | "zh";
  t: (en: string, zh: string) => string;
}) {
  const maxAttn = 100;
  return (
    <div
      onClick={() => onOpen(item.ticker)}
      className="view-in group cursor-pointer rounded-xl border border-line bg-panel2 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-signal/40 hover:bg-white/[0.04] hover:shadow-lg hover:shadow-black/30"
      style={{ animationDelay: `${Math.min(rank, 24) * 18}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[16px] font-bold text-signal group-hover:underline">{item.ticker}</span>
            {item.tier === 1 && (
              <span className="rounded-full border border-gold/60 bg-gold/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-gold">
                ★ {t("CORE", "核心")}
              </span>
            )}
            {item.strongBuy && (
              <span className="rounded-full border border-gold/45 bg-gold/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-gold">
                {t("STRONG", "强买")}
              </span>
            )}
            {item.buyStreak >= SUSTAINED_DAYS && (
              <span className="rounded-full border border-ok/45 bg-ok/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-ok">
                {t(`BUY ${item.buyStreak}D`, `买入 ${item.buyStreak} 天`)}
              </span>
            )}
            {item.inBoth && (
              <span className="rounded-full border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-signal">
                {t("BOTH NETS", "两网")}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {item.company || "—"} · {capLabel(item.cap, lang)}
            {item.sector ? ` · ${sectorLabel(item.sector, lang)}` : ""}
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="font-disp text-[20px] font-semibold leading-none text-text">{item.score}</div>
          <div className="text-[9px] uppercase tracking-wide text-muted2">{t("score", "综合")}</div>
        </div>
      </div>

      {/* attention bar */}
      <div className="mt-3 flex items-center gap-2">
        <span className="w-10 flex-none text-[9.5px] uppercase text-muted2">{t("attn", "注意")}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${((item.attnScore ?? 0) / maxAttn) * 100}%`,
              background: (item.attnScore ?? 0) >= 50 ? "#3dd6c4" : "#5a6a7c",
            }}
          />
        </div>
        <span className="w-16 flex-none text-right font-mono text-[11px] tabular-nums text-muted">
          {item.attnScore ?? "—"}
          {item.rvol != null ? ` · ${item.rvol.toFixed(1)}×` : ""}
        </span>
      </div>

      {/* ecosystem chips */}
      {item.neighbors.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
          <span className="text-[9.5px] uppercase text-muted2">
            {t(`${item.links} links`, `${item.links} 关联`)}
          </span>
          {item.neighbors.slice(0, 6).map((n) => (
            <button
              key={n.ticker}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(n.ticker);
              }}
              className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-transform hover:scale-110"
              style={{ color: GRP_COLOR[n.kind], borderColor: `${GRP_COLOR[n.kind]}55`, background: `${GRP_COLOR[n.kind]}14` }}
              title={
                n.kind === "upstream"
                  ? t(`${n.ticker} supplies ${item.ticker}`, `${n.ticker} 供应 ${item.ticker}`)
                  : n.kind === "downstream"
                    ? t(`${n.ticker} buys from ${item.ticker}`, `${n.ticker} 采购自 ${item.ticker}`)
                    : t(`${n.ticker} competes with ${item.ticker}`, `${n.ticker} 与 ${item.ticker} 竞争`)
              }
            >
              {n.anchor ? "⚓ " : ""}
              {n.ticker}
            </button>
          ))}
          {item.neighbors.length > 6 && (
            <span className="text-[10px] text-muted2">+{item.neighbors.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}
