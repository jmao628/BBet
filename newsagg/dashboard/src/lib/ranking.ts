import type { HomeWidget, RankRow } from "../types";

const NUM_RE = /^[0-5]\.\d{2}$/;

// Short tag for a widget title, used as a column chip in the ranking table.
function shortTag(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("quant rating")) return "Quant";
  if (t.includes("analyst coverage")) return "Coverage";
  if (t.includes("top quant")) return "TopQuant";
  if (t.includes("compelling")) return "Ideas";
  if (t.includes("strong buy")) return "StrongBuy";
  return title.split(" ").slice(0, 2).join(" ");
}

// Aggregate every ticker across all homepage widgets into one ranked list.
export function buildRanking(widgets: HomeWidget[]): RankRow[] {
  const map = new Map<string, RankRow>();

  for (const w of widgets) {
    const tag = shortTag(w.title);
    for (const g of w.groups) {
      for (const r of g.rows) {
        const cur =
          map.get(r.ticker) ??
          ({
            ticker: r.ticker,
            company: r.company ?? "",
            score: null,
            badges: [],
            tags: [],
            caps: [],
          } as RankRow);

        if (r.rating && NUM_RE.test(r.rating)) {
          const n = parseFloat(r.rating);
          cur.score = cur.score == null ? n : Math.max(cur.score, n);
        } else if (r.rating && /buy/i.test(r.rating)) {
          const b = r.rating.toUpperCase();
          if (!cur.badges.includes(b)) cur.badges.push(b);
        }
        if (r.company && !cur.company) cur.company = r.company;
        if (!cur.tags.includes(tag)) cur.tags.push(tag);
        if (g.label && !cur.caps.includes(g.label)) cur.caps.push(g.label);

        map.set(r.ticker, cur);
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.score == null && b.score == null) return b.tags.length - a.tags.length;
    return (b.score ?? -1) - (a.score ?? -1);
  });
}
