// Shapes mirror what newsagg.sa_scrape writes to seekingalpha_latest.json.

export interface WidgetRow {
  ticker: string;
  company: string | null;
  rating: string | null;
  article: string | null;
  article_url: string | null;
  analyst: string | null;
}

export interface WidgetGroup {
  label: string;
  rows: WidgetRow[];
}

export interface HomeWidget {
  title: string;
  description: string;
  groups: WidgetGroup[];
}

export interface AnalystPick {
  analyst: string;
  profile_url: string;
  ticker: string;
  rating: string;
  article_title: string;
  article_url: string;
  published: string | null;
  rank: number | null;
}

export interface SAData {
  generated_at: string | null;
  home_widgets: HomeWidget[];
  analyst_picks: AnalystPick[];
  top_analysts: { name: string; profile_url: string; rank: number | null }[];
  counts?: Record<string, number>;
  errors?: string[];
}

// One aggregated row for the ranking table.
export interface RankRow {
  ticker: string;
  company: string;
  score: number | null; // best numeric quant/analyst score seen
  badges: string[]; // e.g. ["STRONG BUY"]
  tags: string[]; // which widgets it appears in
  caps: string[]; // cap-size buckets (Large/Mid/Small Cap, ...)
}
