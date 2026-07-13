import { useMemo, useState } from "react";
import { useStore, useT } from "../../store";
import {
  buildFocus,
  buildCatalystRows,
  catalystTypeLabel,
  sectorLabel,
  capLabel,
  CATALYST_BAR,
  type CatalystRow,
  type CatalystStatus,
} from "../pipeline";
import { ViewHead, StatStrip } from "../ui";
import type { Catalyst } from "../../types";

const STATUS_META: Record<CatalystStatus, { color: string; en: string; zh: string }> = {
  advance: { color: "#48c78e", en: "Advancing", zh: "过闸" },
  watch: { color: "#e9c46a", en: "Watch", zh: "观察" },
  none: { color: "#5a6a7c", en: "No catalyst", zh: "无催化剂" },
  pending: { color: "#3a4a5a", en: "Pending", zh: "待抓取" },
};

function countdown(iso: string | null, t: (en: string, zh: string) => string): { label: string; near: boolean } {
  if (!iso) return { label: t("date TBD", "日期待定"), near: false };
  const d = new Date(iso + "T00:00:00");
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: t(`${-days}d ago`, `${-days} 天前`), near: false };
  if (days === 0) return { label: t("today", "今天"), near: true };
  return { label: t(`in ${days}d`, `${days} 天后`), near: days <= 30 };
}

function Tpmn({ tpmn }: { tpmn: Catalyst["tpmn"] }) {
  const dims: [string, number, string][] = [
    ["T", tpmn.T, "#9b8cf0"],
    ["P", tpmn.P, "#5fb0e8"],
    ["M", tpmn.M, "#e9c46a"],
    ["N", tpmn.N, "#48c78e"],
  ];
  return (
    <div className="flex items-center gap-2.5">
      {dims.map(([k, v, c]) => (
        <div key={k} className="flex items-center gap-1" title={`${k} ${v.toFixed(2)}`}>
          <span className="font-mono text-[9.5px] text-muted2">{k}</span>
          <span className="h-1.5 w-8 overflow-hidden rounded-full bg-inset">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(4, v * 100)}%`, background: c }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function CatalystLine({ c, lang, t }: { c: Catalyst; lang: "en" | "zh"; t: (en: string, zh: string) => string }) {
  const cd = countdown(c.event_date, t);
  return (
    <div className="rounded-lg border border-line bg-inset/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-[10px] font-medium text-signal">
            {catalystTypeLabel(c.type, lang)}
          </span>
          <span className="text-[12.5px] text-text">{c.title}</span>
        </span>
        <span className="flex flex-none items-center gap-2">
          <span className={`font-mono text-[11px] ${cd.near ? "text-ok" : "text-muted2"}`}>⏳ {cd.label}</span>
          <span className="font-mono text-[13px] font-semibold" style={{ color: c.tpmn.score >= CATALYST_BAR ? "#48c78e" : "#c7d2dc" }}>
            {c.tpmn.score.toFixed(1)}
          </span>
        </span>
      </div>
      {c.thesis && <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{c.thesis}</div>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <Tpmn tpmn={c.tpmn} />
        <a
          href={c.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[10.5px] text-signal hover:underline"
        >
          {t("source", "来源")} ↗
        </a>
      </div>
    </div>
  );
}

function Row({
  r,
  rank,
  onOpen,
  lang,
  t,
}: {
  r: CatalystRow;
  rank: number;
  onOpen: (t: string) => void;
  lang: "en" | "zh";
  t: (en: string, zh: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[r.status];
  const more = r.cat ? r.cat.catalysts.length - 1 : 0;
  return (
    <div
      className="overflow-hidden rounded-2xl border bg-panel2"
      style={{ borderColor: r.status === "advance" ? "#48c78e44" : "var(--line,#22303c)" }}
    >
      <button onClick={() => onOpen(r.ticker)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
        <span className="w-7 flex-none font-mono text-[11px] text-muted2">#{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[15px] font-bold text-signal">{r.ticker}</span>
            {r.core && <span className="text-[10px] text-gold" title="Focus Core">★</span>}
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
              style={{ color: meta.color, background: `${meta.color}1f`, border: `1px solid ${meta.color}55` }}
            >
              {lang === "zh" ? meta.zh : meta.en}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted2">
            {r.company || "—"} · {capLabel(r.cap, lang)}
            {r.sector ? ` · ${sectorLabel(r.sector, lang)}` : ""}
          </span>
        </span>
        {r.catScore >= 0 ? (
          <span className="flex-none text-right">
            <span className="font-disp text-[22px] font-semibold" style={{ color: r.status === "advance" ? "#48c78e" : "#c7d2dc" }}>
              {r.catScore.toFixed(1)}
            </span>
            <span className="text-[10px] text-muted2">/10</span>
          </span>
        ) : (
          <span className="flex-none text-[11px] text-muted2">{t("not fetched", "未抓取")}</span>
        )}
      </button>

      {r.best && (
        <div className="border-t border-line/60 px-4 py-3">
          <CatalystLine c={r.best} lang={lang} t={t} />
          {more > 0 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-2 text-[11px] text-muted hover:text-text"
            >
              {open ? t("hide", "收起") : t(`+${more} more catalyst${more > 1 ? "s" : ""}`, `+${more} 条催化剂`)}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-2">
              {r.cat!.catalysts.slice(1).map((c, i) => (
                <CatalystLine key={i} c={c} lang={lang} t={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CatalystView() {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  const catalyst = useStore((s) => s.catalyst);
  const openDetail = useStore((s) => s.openDetail);
  const lang = useStore((s) => s.lang);
  const t = useT();

  const focus = useMemo(
    () => buildFocus(data, heat, technical, marketCaps, sectors, supplychain),
    [data, heat, technical, marketCaps, sectors, supplychain],
  );
  const rows = useMemo(() => buildCatalystRows(focus, catalyst), [focus, catalyst]);

  const counts = useMemo(() => {
    const c = { advance: 0, watch: 0, none: 0, pending: 0 } as Record<CatalystStatus, number>;
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const [filter, setFilter] = useState<CatalystStatus | "all">("all");
  const [sector, setSector] = useState<string | null>(null);

  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.sector && r.status !== "pending") m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (sector) list = list.filter((r) => r.sector === sector);
    return list;
  }, [rows, filter, sector]);

  const fetched = counts.advance + counts.watch + counts.none;

  const FILTERS: { k: CatalystStatus | "all"; label: string; n: number }[] = [
    { k: "all", label: t("All", "全部"), n: rows.length },
    { k: "advance", label: t("Advancing", "过闸"), n: counts.advance },
    { k: "watch", label: t("Watch", "观察"), n: counts.watch },
    { k: "none", label: t("No catalyst", "无催化剂"), n: counts.none },
    { k: "pending", label: t("Pending", "待抓取"), n: counts.pending },
  ];

  return (
    <div className="view-in">
      <ViewHead
        eyebrow={t("Stage 3 · Catalyst", "Stage 3 · 催化剂")}
        title={t("Catalyst · TPMN", "催化剂 · TPMN")}
        desc={t(
          `Every catalyst is web-searched and must carry a real source URL — no citation, no catalyst (nothing is ranked on a made-up date). Each is scored 0-10 on TPMN: Trigger (type) · Probability (chance it fires and surprises up, de-rated by how priced-in it is) · Magnitude (est. % re-rating) · Nearness (how soon a dated event is). A name takes its strongest catalyst and ADVANCES at ≥${CATALYST_BAR}; the rest stay on the list (graded, not cut).`,
          `每条催化剂都是联网搜出来的,且必须带真实来源链接——没链接就不算(绝不拿编造的日期排名)。每条按 TPMN 打 0-10 分:Trigger 触发类型 · Probability 兑现且正向 surprise 的概率(按已 price-in 程度打折) · Magnitude 预计重定价幅度 · Nearness 带日期事件的临近度。每票取最强那条,≥${CATALYST_BAR} 分过闸;其余保留(分级不砍)。`,
        )}
      />

      {catalyst == null ? (
        <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
          {t(
            "No catalyst data yet — run  python -m newsagg.catalyst  on the Mac (OpenAI web search). It caches to catalyst.json and fills in here.",
            "暂无催化剂数据 —— 在 Mac 上跑  python -m newsagg.catalyst (OpenAI 联网搜)。结果缓存到 catalyst.json 后这里自动填充。",
          )}
        </div>
      ) : (
        <>
          <StatStrip
            stats={[
              { k: t("Advancing", "过闸"), v: counts.advance, d: t(`catalyst ≥ ${CATALYST_BAR}`, `催化剂 ≥ ${CATALYST_BAR}`), color: "#48c78e" },
              { k: t("Watch", "观察"), v: counts.watch, d: t("has a weaker catalyst", "有较弱催化剂"), color: "#e9c46a" },
              { k: t("No catalyst", "无催化剂"), v: counts.none, d: t("fetched, none found", "已抓,未发现"), color: "#8aa0b4" },
              { k: t("Coverage", "覆盖"), v: `${fetched}/${rows.length}`, d: t("Focus names fetched", "重点名单已抓取") },
            ]}
          />

          <div className="mb-4 flex flex-wrap items-center gap-1.5">
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
            {sectorCounts.length > 0 && <span className="mx-1 h-4 w-px bg-line" />}
            {sector && (
              <button onClick={() => setSector(null)} className="rounded-full border border-signal/50 bg-signal/10 px-2.5 py-0.5 text-[12px] text-signal">
                {sectorLabel(sector, lang)} ✕
              </button>
            )}
            {!sector &&
              sectorCounts.slice(0, 8).map(([sec, n]) => (
                <button
                  key={sec}
                  onClick={() => setSector(sec)}
                  className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted hover:text-text"
                >
                  {sectorLabel(sec, lang)} {n}
                </button>
              ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-8 text-center text-[13px] text-muted">
              {t("No names match this filter.", "该筛选下没有匹配的票。")}
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
              {shown.map((r, i) => (
                <Row key={r.ticker} r={r} rank={i + 1} onOpen={openDetail} lang={lang} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
