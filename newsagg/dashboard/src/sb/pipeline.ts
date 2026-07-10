// Transforms the scraped SeekingAlpha snapshot into the SuperBeta pipeline's
// data shapes. Only Stage-1 (seed table) and the ticker universe are real
// today; heat / catalyst / conviction / technical are computed later and are
// surfaced as "pending" in their views.

import type { HeatData, MarketCaps, SAData, TechnicalData, SectorData } from "../types";

// yfinance GICS sectors → short Chinese labels.
export const SECTOR_CN: Record<string, string> = {
  Technology: "科技",
  Healthcare: "医疗",
  "Financial Services": "金融",
  "Consumer Cyclical": "可选消费",
  "Consumer Defensive": "必需消费",
  Industrials: "工业",
  Energy: "能源",
  "Basic Materials": "原材料",
  "Communication Services": "通讯",
  Utilities: "公用",
  "Real Estate": "地产",
};

export function sectorCN(sector: string | undefined): string {
  if (!sector) return "其他";
  return SECTOR_CN[sector] ?? sector;
}

// Lang-aware label: English keeps yfinance's own English sector; Chinese maps it.
export function sectorLabel(sector: string | undefined, lang: "en" | "zh"): string {
  if (!sector) return lang === "zh" ? "其他" : "—";
  return lang === "zh" ? SECTOR_CN[sector] ?? sector : sector;
}

export type CatalystType =
  | "earnings"
  | "guidance"
  | "new_order"
  | "policy"
  | "m_and_a"
  | "other"
  | "unknown";

export type Role = "upstream" | "downstream" | "unknown";

export interface SeedRow {
  src: string; // SeekingAlpha | Substack | Schwab YT | X
  date: string | null;
  author: string | null;
  followers: string | null; // pending until we join follower counts
  ticker: string;
  company: string;
  reasoning: string; // article thesis / summary (only for analyst-thesis rows)
  articleUrl: string | null; // link to the analyst's SeekingAlpha article
  evidence: string | null;
  catalyst: CatalystType; // pending real LLM classification
  role: Role; // pending real LLM classification
  weight: number | null; // author weight — pending whitelist join
  rating: string | null; // best display rating (BUY/STRONG BUY or quant score)
  quant: number | null; // best numeric quant score
  tags: string[]; // SA widgets it appears in (Quant/Coverage/Ideas/...)
  hasThesis: boolean; // appears in "Most Compelling Analyst Ideas" (analyst wrote a bull thesis)
}

export interface UniStock {
  ticker: string;
  company: string;
  quant: number | null; // best numeric quant score across widgets
  rated: boolean; // has an SA rating (quant score or BUY/STRONG BUY) somewhere
  tags: string[]; // widgets it appears in
  caps: string[]; // cap-size buckets
}

const NUM_RE = /^[0-5]\.\d{2}$/;

function shortTag(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("quant rating")) return "Quant";
  if (t.includes("analyst coverage")) return "Coverage";
  if (t.includes("top quant")) return "TopQuant";
  if (t.includes("compelling")) return "Ideas";
  if (t.includes("strong buy")) return "StrongBuy";
  if (t.includes("value idea")) return "Value";
  if (t.includes("dividend")) return "Dividend";
  if (t.includes("growth idea")) return "Growth";
  if (t.includes("momentum")) return "Momentum";
  if (t.includes("profitab")) return "Profit";
  if (t.includes("eps revision")) return "EPS";
  return title.split(" ").slice(0, 2).join(" ");
}

export function companyMap(data: SAData | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const w of data?.home_widgets ?? [])
    for (const g of w.groups)
      for (const r of g.rows) if (r.company && !m.has(r.ticker)) m.set(r.ticker, r.company);
  return m;
}

// Stage-1 seeds: every bullish SeekingAlpha ticker across all widgets, one
// deduped row per ticker. Rows that appear in "Most Compelling Analyst Ideas"
// (an analyst actually wrote a bull thesis) are flagged hasThesis and carry
// the author + article; the rest are quant/coverage-list bulls. Thesis rows
// sort first, then by quant score.
export function buildSeeds(data: SAData | null): SeedRow[] {
  if (!data) return [];
  const cmap = companyMap(data);
  const map = new Map<string, SeedRow>();

  for (const w of data.home_widgets) {
    const tag = shortTag(w.title);
    for (const g of w.groups) {
      for (const r of g.rows) {
        const cur: SeedRow =
          map.get(r.ticker) ??
          {
            src: "SeekingAlpha",
            date: data.generated_at ? data.generated_at.slice(0, 10) : null,
            author: null,
            followers: null,
            ticker: r.ticker,
            company: r.company ?? cmap.get(r.ticker) ?? "",
            reasoning: "",
            articleUrl: null,
            evidence: null,
            catalyst: "unknown",
            role: "unknown",
            weight: null,
            rating: null,
            quant: null,
            tags: [],
            hasThesis: false,
          };

        if (!cur.tags.includes(tag)) cur.tags.push(tag);
        if (r.company && !cur.company) cur.company = r.company;
        if (r.rating) {
          if (NUM_RE.test(r.rating)) {
            const n = parseFloat(r.rating);
            cur.quant = cur.quant == null ? n : Math.max(cur.quant, n);
            if (!cur.rating) cur.rating = r.rating;
          } else {
            cur.rating = r.rating; // BUY / STRONG BUY wins for display
          }
        }
        // Any row an analyst wrote a thesis for (author + article) is a ★ seed,
        // regardless of which "… Ideas" widget it came from.
        if (r.analyst || r.article) {
          cur.hasThesis = true;
          if (r.analyst) cur.author = r.analyst;
          if (r.article && !cur.reasoning) {
            cur.reasoning = r.article;
            cur.articleUrl = r.article_url;
          }
        }
        map.set(r.ticker, cur);
      }
    }
  }

  // Merge in the "My Analysts" feed — recent Buy/Strong Buy articles from the
  // analysts you follow. These are always ★ thesis seeds (author + article).
  for (const p of data.my_analyst_picks ?? []) {
    const cur: SeedRow =
      map.get(p.ticker) ??
      {
        src: "SeekingAlpha",
        date: p.published,
        author: null,
        followers: null,
        ticker: p.ticker,
        company: cmap.get(p.ticker) ?? "",
        reasoning: "",
        articleUrl: null,
        evidence: null,
        catalyst: "unknown",
        role: "unknown",
        weight: null,
        rating: null,
        quant: null,
        tags: [],
        hasThesis: false,
      };
    cur.hasThesis = true;
    if (p.author) cur.author = p.author;
    if (p.article_title && !cur.reasoning) {
      cur.reasoning = p.article_title;
      cur.articleUrl = p.article_url;
    }
    if (p.rating) cur.rating = p.rating;
    if (p.published) cur.date = p.published;
    if (!cur.tags.includes("MyAnalyst")) cur.tags.push("MyAnalyst");
    map.set(p.ticker, cur);
  }

  return [...map.values()].sort((a, b) => {
    if (a.hasThesis !== b.hasThesis) return a.hasThesis ? -1 : 1;
    return (b.quant ?? -1) - (a.quant ?? -1);
  });
}

export type CapSize = "large" | "mid" | "small" | "unknown";

// Infer cap size from the SA widget cap-group labels a ticker appears in
// (Large Cap / S&P 500, Mid Cap / Mid Cap 400, Small Cap / Small Cap 600).
export function capSizeOf(caps: string[]): CapSize {
  const j = caps.join(" ").toLowerCase();
  if (j.includes("large") || j.includes("s&p 500")) return "large";
  if (j.includes("small")) return "small";
  if (j.includes("mid")) return "mid";
  return "unknown";
}

// Cap-size from real market cap (USD), falling back to SA cap-group labels
// when we don't have a market cap for the ticker. Large ≥ $10B, Mid ≥ $2B.
export function capSizeFromCap(marketCap: number | undefined, labels: string[]): CapSize {
  if (marketCap && marketCap > 0) {
    if (marketCap >= 10e9) return "large";
    if (marketCap >= 2e9) return "mid";
    return "small";
  }
  return capSizeOf(labels);
}

// Only true mega caps are "already discovered" enough to skip social heat.
// Everything below this still runs the heat/discovery funnel.
export const BYPASS_MARKET_CAP = 100e9; // ≥ $100B

export function bypassesHeat(marketCap: number | undefined): boolean {
  return !!marketCap && marketCap >= BYPASS_MARKET_CAP;
}

// Passes the heat gate if it's a mega cap (bypass), OR social heat has
// ignited/detonated, OR price-volume attention has ignited. The last lane is
// what lets thinly-discussed mid/small caps through — social mentions are too
// sparse for them, but volume/breakout/OBV show accumulation first.
export function passesHeatGate(
  marketCap: number | undefined,
  phase: string,
  attnIgnites = false,
): boolean {
  return (
    bypassesHeat(marketCap) || phase === "ignite" || phase === "detonate" || attnIgnites
  );
}

export function buildUniverse(data: SAData | null): UniStock[] {
  const map = new Map<string, UniStock>();
  for (const w of data?.home_widgets ?? []) {
    const tag = shortTag(w.title);
    for (const g of w.groups) {
      for (const r of g.rows) {
        const cur =
          map.get(r.ticker) ??
          ({ ticker: r.ticker, company: r.company ?? "", quant: null, rated: false, tags: [], caps: [] } as UniStock);
        if (r.rating) {
          cur.rated = true; // any rating cell (quant score or BUY/STRONG BUY)
          if (NUM_RE.test(r.rating)) {
            const n = parseFloat(r.rating);
            cur.quant = cur.quant == null ? n : Math.max(cur.quant, n);
          }
        }
        if (r.company && !cur.company) cur.company = r.company;
        if (!cur.tags.includes(tag)) cur.tags.push(tag);
        if (g.label && !cur.caps.includes(g.label)) cur.caps.push(g.label);
        map.set(r.ticker, cur);
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.quant ?? -1) - (a.quant ?? -1));
}

// Stage 2 — Rankings. The whole rated seed universe (all ~277) is ranked by
// several independent lenses (price-volume attention, raw relative volume,
// momentum, social heat). The top `topN` of EACH lens advances to Stage 3 —
// so a name can qualify by volume even if it's socially silent, and vice
// versa. Mega caps auto-advance (already discovered). This replaces the old
// binary ignite gate, which surfaced too few names.
export interface RankItem {
  ticker: string;
  company: string;
  cap: CapSize;
  sector: string; // raw yfinance sector ("" if unknown)
  value: number;
  display: string;
  rank: number;
  meetsBar: boolean; // value clears this lens's minimum threshold
  inTop: boolean; // top-N of this lens AND clears the bar (the ranking path)
  strongBuy: boolean; // technical gauge = 强力买入 (a separate advance path)
  advancing: boolean; // inTop || strongBuy
}

export interface BiText {
  en: string;
  zh: string;
}

export interface Ranking {
  key: string;
  label: BiText;
  desc: BiText;
  rows: RankItem[];
}

export interface StrongBuyItem {
  ticker: string;
  company: string;
  cap: CapSize;
  sector: string;
  score: number; // price-volume attention score (for sorting)
  rvol: number | null;
}

export interface RankBundle {
  rankings: Ranking[];
  advancing: Set<string>; // union of every lens's top-N (+ mega caps)
  advancingBy: Map<string, string[]>; // ticker -> lens keys it advanced in
  strongBuys: StrongBuyItem[]; // every rated ticker with a 强力买入 gauge, sorted
  universe: number; // rated seed count
}

interface Lens {
  key: string;
  label: BiText;
  desc: BiText;
  min: number; // value must clear this to count as "ignited" (else stays dim)
  get: (t: string) => number | null;
  fmt: (v: number) => string;
  tie?: (t: string) => number; // continuous tiebreaker when many share a score
}

export function buildRankings(
  data: SAData | null,
  heat: HeatData | null,
  technical: TechnicalData | null,
  marketCaps: MarketCaps | null,
  sectors: SectorData | null = null,
  topN = 10,
): RankBundle {
  const uni = buildUniverse(data).filter((u) => u.rated);
  const cmap = companyMap(data);
  const capsByTicker = new Map(uni.map((u) => [u.ticker, u.caps]));
  const capOf = (t: string) => capSizeFromCap(marketCaps?.[t], capsByTicker.get(t) ?? []);
  const sectorOf = (t: string) => sectors?.[t]?.sector ?? "";
  const attn = (t: string) => technical?.tickers?.[t]?.attention;
  const isStrongBuy = (t: string) => technical?.tickers?.[t]?.gauge?.summary === "strong_buy";

  const momentum = (t: string): number | null => {
    const cs = technical?.tickers?.[t]?.close_series;
    if (!cs || cs.length < 2 || !cs[0]) return null;
    return (cs[cs.length - 1] / cs[0] - 1) * 100;
  };

  // `min` = the "达标" bar. A name in the top-N still stays dim (not 入选) unless
  // it clears the bar — so on a weak day nothing lights up rather than forcing it.
  const lenses: Lens[] = [
    {
      key: "attention",
      label: { en: "Price-Volume Attention", zh: "量价注意力" },
      desc: {
        en: "RVOL + breakout + OBV + trend composite · bar 50",
        zh: "RVOL + 突破 + OBV + 趋势 综合分,达标线 50",
      },
      min: 50,
      get: (t) => attn(t)?.score ?? null,
      fmt: (v) => `${Math.round(v)}`,
      // The score is coarse (many tie at 60) — break ties by RVOL then momentum
      // so who lands in the top-10 is meaningful, not arbitrary.
      tie: (t) => (attn(t)?.rvol ?? 0) + (momentum(t) ?? 0) / 1000,
    },
    {
      key: "rvol",
      label: { en: "Relative Volume", zh: "放量 RVOL" },
      desc: { en: "5-day / 20-day avg volume · bar 1.5×", zh: "近 5 日 / 20 日均量,达标线 1.5×" },
      min: 1.5,
      get: (t) => attn(t)?.rvol ?? null,
      fmt: (v) => `${v.toFixed(2)}×`,
    },
    {
      key: "momentum",
      label: { en: "Momentum 60d", zh: "动量 60 日" },
      desc: { en: "Return over last 60 trading days · bar +10%", zh: "近 60 个交易日涨幅,达标线 +10%" },
      min: 10,
      get: (t) => momentum(t),
      fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
    },
    {
      key: "social",
      label: { en: "Social Heat", zh: "社交热度" },
      desc: { en: "Ape Wisdom z-score · bar 0.5 (ignite)", zh: "Ape Wisdom z 分数,达标线 0.5(点火线)" },
      min: 0.5,
      get: (t) => heat?.tickers?.[t]?.z ?? null,
      fmt: (v) => v.toFixed(2),
    },
  ];

  const rankings: Ranking[] = [];
  const advancing = new Set<string>();
  const advancingBy = new Map<string, string[]>();

  for (const L of lenses) {
    const rows: RankItem[] = uni
      .map((u) => ({ t: u.ticker, v: L.get(u.ticker) }))
      .filter((x): x is { t: string; v: number } => x.v != null && !Number.isNaN(x.v))
      .sort((a, b) => b.v - a.v || (L.tie?.(b.t) ?? 0) - (L.tie?.(a.t) ?? 0))
      .map((x, i) => {
        const meetsBar = x.v >= L.min;
        const inTop = i < topN && meetsBar;
        const strongBuy = isStrongBuy(x.t);
        return {
          ticker: x.t,
          company: cmap.get(x.t) ?? "",
          cap: capOf(x.t),
          sector: sectorOf(x.t),
          value: x.v,
          display: L.fmt(x.v),
          rank: i + 1,
          meetsBar,
          inTop,
          strongBuy,
          advancing: inTop || strongBuy,
        };
      });
    if (!rows.length) continue;
    rankings.push({ key: L.key, label: L.label, desc: L.desc, rows });
    for (const r of rows) {
      if (!r.inTop) continue; // ranking path: top-N clearing the bar
      advancing.add(r.ticker);
      advancingBy.set(r.ticker, [...(advancingBy.get(r.ticker) ?? []), L.key]);
    }
  }

  // Strong-Buy path: any rated ticker whose technical gauge reads 强力买入
  // advances regardless of rank (not tied to the top-10 line).
  for (const u of uni) {
    if (isStrongBuy(u.ticker)) {
      advancing.add(u.ticker);
      const prev = advancingBy.get(u.ticker) ?? [];
      if (!prev.includes("strongbuy")) advancingBy.set(u.ticker, [...prev, "strongbuy"]);
    }
  }

  // Mega caps are already discovered — auto-advance them.
  for (const u of uni) {
    if (bypassesHeat(marketCaps?.[u.ticker])) {
      advancing.add(u.ticker);
      if (!advancingBy.has(u.ticker)) advancingBy.set(u.ticker, ["bypass"]);
    }
  }

  // Full 强力买入 list, sorted by attention score (then RVOL), for its own card.
  const strongBuys: StrongBuyItem[] = uni
    .filter((u) => isStrongBuy(u.ticker))
    .map((u) => ({
      ticker: u.ticker,
      company: cmap.get(u.ticker) ?? "",
      cap: capOf(u.ticker),
      sector: sectorOf(u.ticker),
      score: attn(u.ticker)?.score ?? 0,
      rvol: attn(u.ticker)?.rvol ?? null,
    }))
    .sort((a, b) => b.score - a.score || (b.rvol ?? 0) - (a.rvol ?? 0));

  return { rankings, advancing, advancingBy, strongBuys, universe: uni.length };
}

// Screen — the *quality net*, run in PARALLEL with Heat (not downstream of it).
// A seed is a screen candidate when it (0) has an SA rating (quant score or
// BUY/STRONG BUY — thesis-only mentions with no rating, e.g. IREN, don't
// qualify) AND (1) has author quality — proxied by an analyst thesis until an
// author whitelist exists. Whether it ALSO cleared the attention board (Heat)
// is recorded as `advanced` (the overlap is what later stages act on) but is no
// longer a gate — so Screen and Heat are two independent lenses.
export type GateVia = "bypass" | "social" | "volume";

export interface ScreenRow {
  ticker: string;
  company: string;
  cap: CapSize;
  bypass: boolean; // mega cap that skipped social heat
  advanced: boolean; // also cleared the Heat attention board (the overlap)
  via: GateVia; // if advanced, how it cleared the attention board
  lenses: string[]; // ranking lenses it advanced in (attention/rvol/momentum/social)
  phase: string | null; // social heat phase
  attnPhase: string | null; // price-volume attention phase
  attnScore: number | null;
  rvol: number | null;
  hasThesis: boolean;
  author: string | null;
  reasoning: string;
  articleUrl: string | null;
  rating: string | null;
  z: number | null;
}

const CAP_RANK: Record<CapSize, number> = { large: 0, mid: 1, small: 2, unknown: 3 };

export function buildScreen(
  data: SAData | null,
  heat: HeatData | null,
  marketCaps: MarketCaps | null,
  technical: TechnicalData | null,
): { candidates: ScreenRow[]; total: number; passedHeat: number } {
  const seeds = buildSeeds(data);
  const uniCaps = new Map(buildUniverse(data).map((u) => [u.ticker, u.caps]));
  const { advancing, advancingBy } = buildRankings(data, heat, technical, marketCaps);
  const candidates: ScreenRow[] = [];
  let passedHeat = 0;

  for (const s of seeds) {
    // Quality net: must have an SA rating AND an analyst thesis. Independent of Heat.
    if (s.rating == null && s.quant == null) continue;
    if (!s.hasThesis) continue;
    const mc = marketCaps?.[s.ticker];
    const cap = capSizeFromCap(mc, uniCaps.get(s.ticker) ?? []);
    const ht = heat?.tickers?.[s.ticker];
    const phase = ht?.phase ?? null;
    const attn = technical?.tickers?.[s.ticker]?.attention;
    // Overlap with the Heat attention board (recorded, not gated).
    const advanced = advancing.has(s.ticker);
    const lenses = advancingBy.get(s.ticker) ?? [];
    if (advanced) passedHeat++;
    const via: GateVia = bypassesHeat(mc)
      ? "bypass"
      : lenses.includes("social") && !lenses.some((l) => l !== "social")
        ? "social"
        : "volume";
    candidates.push({
      ticker: s.ticker,
      company: s.company,
      cap,
      bypass: bypassesHeat(mc),
      advanced,
      via,
      lenses,
      phase,
      attnPhase: attn?.phase ?? null,
      attnScore: attn?.score ?? null,
      rvol: attn?.rvol ?? null,
      hasThesis: s.hasThesis,
      author: s.author,
      reasoning: s.reasoning,
      articleUrl: s.articleUrl,
      rating: s.rating,
      z: ht?.z ?? null,
    });
  }

  // Overlap (in both nets) first, then by cap, then by heat z / attention.
  candidates.sort(
    (a, b) =>
      Number(b.advanced) - Number(a.advanced) ||
      CAP_RANK[a.cap] - CAP_RANK[b.cap] ||
      (b.z ?? -99) - (a.z ?? -99) ||
      (b.attnScore ?? -1) - (a.attnScore ?? -1),
  );
  return { candidates, total: seeds.length, passedHeat };
}

export const CATALYST_CN: Record<CatalystType, string> = {
  earnings: "财报",
  guidance: "指引",
  new_order: "新订单",
  policy: "政策",
  m_and_a: "并购",
  other: "其他",
  unknown: "待定",
};

export const ROLE_CN: Record<Role, string> = {
  upstream: "上游",
  downstream: "下游",
  unknown: "待定",
};

export const CATALYST_EN: Record<CatalystType, string> = {
  earnings: "Earnings",
  guidance: "Guidance",
  new_order: "New Order",
  policy: "Policy",
  m_and_a: "M&A",
  other: "Other",
  unknown: "TBD",
};

export const ROLE_EN: Record<Role, string> = {
  upstream: "Upstream",
  downstream: "Downstream",
  unknown: "TBD",
};

export const CAP_LABEL: Record<CapSize, { en: string; zh: string }> = {
  large: { en: "Large", zh: "大盘" },
  mid: { en: "Mid", zh: "中盘" },
  small: { en: "Small", zh: "小盘" },
  unknown: { en: "—", zh: "—" },
};

export function capLabel(cap: CapSize, lang: "en" | "zh"): string {
  return lang === "zh" ? CAP_LABEL[cap].zh : CAP_LABEL[cap].en;
}
