// Transforms the scraped SeekingAlpha snapshot into the SuperBeta pipeline's
// data shapes. Only Stage-1 (seed table) and the ticker universe are real
// today; heat / catalyst / conviction / technical are computed later and are
// surfaced as "pending" in their views.

import type { SAData } from "../types";

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
  reasoning: string; // article thesis / summary
  evidence: string | null;
  catalyst: CatalystType; // pending real LLM classification
  role: Role; // pending real LLM classification
  weight: number | null; // author weight — pending whitelist join
  rating: string | null; // raw SA rating if any
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
  return title.split(" ").slice(0, 2).join(" ");
}

export function companyMap(data: SAData | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const w of data?.home_widgets ?? [])
    for (const g of w.groups)
      for (const r of g.rows) if (r.company && !m.has(r.ticker)) m.set(r.ticker, r.company);
  return m;
}

// Real Stage-1 seeds we can build today: the "Most Compelling Analyst Ideas"
// widget gives analyst + article + Buy/Strong Buy per ticker — the closest
// thing to a normalized bullish seed before the LLM step is wired.
export function buildSeeds(data: SAData | null): SeedRow[] {
  if (!data) return [];
  const cmap = companyMap(data);
  const seeds: SeedRow[] = [];

  for (const w of data.home_widgets) {
    if (!w.title.toLowerCase().includes("compelling")) continue;
    for (const g of w.groups) {
      for (const r of g.rows) {
        seeds.push({
          src: "SeekingAlpha",
          date: data.generated_at ? data.generated_at.slice(0, 10) : null,
          author: r.analyst,
          followers: null,
          ticker: r.ticker,
          company: r.company ?? cmap.get(r.ticker) ?? "",
          reasoning: r.article ?? "",
          evidence: null,
          catalyst: "unknown",
          role: "unknown",
          weight: null,
          rating: r.rating,
        });
      }
    }
  }
  return seeds;
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
