import { create } from "zustand";
import type { HomeWidget, SAData } from "./types";

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
  status: ConnStatus;
  lastUpdated: number | null; // epoch ms of last successful fetch
  view: ViewKey; // active view in the funnel
  ticker: string; // focused ticker (search / row click)
  setData: (d: SAData) => void;
  setStatus: (s: ConnStatus) => void;
  setView: (v: ViewKey) => void;
  setTicker: (t: string) => void;
}

export const useStore = create<DashboardState>((set) => ({
  data: null,
  status: "connecting",
  lastUpdated: null,
  view: "overview",
  ticker: "",
  setData: (d) => set({ data: d, status: "live", lastUpdated: Date.now() }),
  setStatus: (s) => set({ status: s }),
  setView: (v) => set({ view: v }),
  setTicker: (t) => set({ ticker: t.toUpperCase().replace(/[^A-Z.:-]/g, "") }),
}));

// Stable empty reference: selectors must NOT return a fresh `?? []` each call,
// or useSyncExternalStore sees a new snapshot every render → infinite loop.
const EMPTY_WIDGETS: HomeWidget[] = [];
export const useWidgets = (): HomeWidget[] =>
  useStore((s) => s.data?.home_widgets ?? EMPTY_WIDGETS);
