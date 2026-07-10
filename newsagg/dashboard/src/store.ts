import { create } from "zustand";
import type { HeatData, Health, HomeWidget, MarketCaps, SAData, TechnicalData, SectorData } from "./types";

export type ConnStatus = "connecting" | "live" | "stale" | "error";

export type ViewKey =
  | "overview"
  | "seeds"
  | "heat"
  | "screen"
  | "catalyst"
  | "conviction"
  | "technical"
  | "candidates";

interface DashboardState {
  data: SAData | null;
  heat: HeatData | null;
  technical: TechnicalData | null;
  sectors: SectorData | null;
  marketCaps: MarketCaps | null;
  health: Health | null;
  status: ConnStatus;
  lastUpdated: number | null; // epoch ms of last successful fetch
  view: ViewKey; // active view in the funnel
  ticker: string; // focused ticker (search / row click)
  detail: string | null; // ticker whose full detail page is open (overlay)
  setData: (d: SAData) => void;
  setHeat: (h: HeatData | null) => void;
  setTechnical: (t: TechnicalData | null) => void;
  setSectors: (s: SectorData | null) => void;
  setMarketCaps: (m: MarketCaps | null) => void;
  setHealth: (h: Health | null) => void;
  setStatus: (s: ConnStatus) => void;
  setView: (v: ViewKey) => void;
  setTicker: (t: string) => void;
  openDetail: (t: string) => void;
  closeDetail: () => void;
}

export const useStore = create<DashboardState>((set) => ({
  data: null,
  heat: null,
  technical: null,
  sectors: null,
  marketCaps: null,
  health: null,
  status: "connecting",
  lastUpdated: null,
  view: "overview",
  ticker: "",
  detail: null,
  setData: (d) => set({ data: d, status: "live", lastUpdated: Date.now() }),
  setHeat: (h) => set({ heat: h }),
  setTechnical: (t) => set({ technical: t }),
  setSectors: (s) => set({ sectors: s }),
  setMarketCaps: (m) => set({ marketCaps: m }),
  setHealth: (h) => set({ health: h }),
  setStatus: (s) => set({ status: s }),
  setView: (v) => set({ view: v }),
  setTicker: (t) => set({ ticker: t.toUpperCase().replace(/[^A-Z.:-]/g, "") }),
  openDetail: (t) => set({ detail: t.toUpperCase().replace(/[^A-Z.:-]/g, "") }),
  closeDetail: () => set({ detail: null }),
}));

// Stable empty reference: selectors must NOT return a fresh `?? []` each call,
// or useSyncExternalStore sees a new snapshot every render → infinite loop.
const EMPTY_WIDGETS: HomeWidget[] = [];
export const useWidgets = (): HomeWidget[] =>
  useStore((s) => s.data?.home_widgets ?? EMPTY_WIDGETS);
