// Transforms the scraped SeekingAlpha snapshot into the SuperBeta pipeline's
// data shapes. Only Stage-1 (seed table) and the ticker universe are real
// today; heat / catalyst / conviction / technical are computed later and are
// surfaced as "pending" in their views.

import type { HeatData, MarketCaps, SAData } from "../types";

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

// Big caps are already well-covered, so they bypass the social-heat gate and
// pass straight to screening; only mid/small caps need heat ignition.
export function passesHeatGate(cap: CapSize, phase: string): boolean {
  if (cap === "large") return true;
  return phase === "ignite" || phase === "detonate";
}

export function buildUniverse(data: SAData | null): UniStock[] {
  const map = new Map<string, UniStock>();
  for (const w of data?.home_widgets ?? []) {
    const tag = shortTag(w.title);
    for (const g of w.groups) {
      for (const r of g.rows) {
        const cur =
          map.get(r.ticker) ??
          ({ ticker: r.ticker, company: r.company ?? "", quant: null, tags: [], caps: [] } as UniStock);
        if (r.rating && NUM_RE.test(r.rating)) {
          const n = parseFloat(r.rating);
          cur.quant = cur.quant == null ? n : Math.max(cur.quant, n);
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

// Stage 3 — Screen. A seed becomes a discovery candidate when it (1) passes
// the heat gate (big cap bypass, or mid/small ignited) AND (2) has author
// quality — proxied by an analyst thesis until an author whitelist exists.
export interface ScreenRow {
  ticker: string;
  company: string;
  cap: CapSize;
  phase: string | null;
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
): { candidates: ScreenRow[]; total: number; passedHeat: number } {
  const seeds = buildSeeds(data);
  const uniCaps = new Map(buildUniverse(data).map((u) => [u.ticker, u.caps]));
  const candidates: ScreenRow[] = [];
  let passedHeat = 0;

  for (const s of seeds) {
    const cap = capSizeFromCap(marketCaps?.[s.ticker], uniCaps.get(s.ticker) ?? []);
    const ht = heat?.tickers?.[s.ticker];
    const phase = ht?.phase ?? null;
    const passHeat = passesHeatGate(cap, phase ?? "");
    if (passHeat) passedHeat++;
    if (passHeat && s.hasThesis) {
      candidates.push({
        ticker: s.ticker,
        company: s.company,
        cap,
        phase,
        hasThesis: s.hasThesis,
        author: s.author,
        reasoning: s.reasoning,
        articleUrl: s.articleUrl,
        rating: s.rating,
        z: ht?.z ?? null,
      });
    }
  }

  candidates.sort(
    (a, b) => CAP_RANK[a.cap] - CAP_RANK[b.cap] || (b.z ?? -99) - (a.z ?? -99),
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
