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

export interface MyAnalystPick {
  ticker: string;
  rating: string; // Buy | Strong Buy
  article_title: string;
  article_url: string;
  author: string | null;
  published: string | null;
}

export interface SAData {
  generated_at: string | null;
  home_widgets: HomeWidget[];
  analyst_picks: AnalystPick[];
  my_analyst_picks?: MyAnalystPick[];
  top_analysts: { name: string; profile_url: string; rank: number | null }[];
  counts?: Record<string, number>;
  errors?: string[];
}

export type MarketCaps = Record<string, number>; // ticker -> market cap (USD)

export interface HeatTicker {
  mentions: number;
  z: number | null;
  vel: number | null;
  accel: number | null;
  phase: "dead" | "ignite" | "detonate" | "watch" | "ultralow" | "warming";
  days: number;
  series: number[];
  z_series: (number | null)[];
}

export interface HeatData {
  generated_at: string | null;
  params: Record<string, number>;
  tickers: Record<string, HeatTicker>;
}

// Price-volume attention: is a mid/small cap starting to get noticed?
export interface TechAttention {
  score: number; // 0-100 composite attention score
  phase: "breakout" | "igniting" | "accumulating" | "quiet";
  ignites: boolean; // passes price-volume ignition (igniting | breakout)
  rvol: number | null; // 5d avg volume / 20d avg volume
  new_high_20d: boolean;
  new_high_52w: boolean;
  dist_to_high: number | null; // fraction below the 20-day high
  obv_up: boolean; // on-balance-volume rising (accumulation)
  above_sma50: boolean;
  sma50_rising: boolean;
}

// investing.com-style mechanical MA + oscillator aggregate. Display only — lags.
export interface TechGauge {
  summary: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  ma_buy: number;
  ma_sell: number;
  osc_buy: number;
  osc_sell: number;
  osc_neutral: number;
  rsi: number | null;
  macd_hist: number | null;
}

export interface TechTicker {
  price: number;
  change_pct: number | null;
  atr_pct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  days: number;
  attention: TechAttention;
  gauge: TechGauge;
  close_series: number[];
  vol_series: number[];
}

export interface TechnicalData {
  tickers: Record<string, TechTicker>;
}

export type SectorData = Record<string, { sector: string; industry: string }>;

// LLM-derived supply chain (newsagg/supplychain.py). One short reason per edge.
export interface SupplyEdge {
  ticker: string; // US ticker, or "" if not publicly traded / unknown
  name: string;
  reason: string;
}
export interface SupplyMap {
  upstream: SupplyEdge[];
  downstream: SupplyEdge[];
  peers: SupplyEdge[];
  model?: string;
  ok?: boolean;
}
export type SupplyChainData = Record<string, SupplyMap>;

export interface Health {
  last_attempt: string | null;
  last_success: string | null;
  auth_ok: boolean;
  widgets: number;
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
