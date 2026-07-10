import type { ViewKey } from "../store";

// The funnel is the product's backbone: seed table → heat → screen → catalyst
// → conviction → technical, bracketed by an overview and the final candidates.
export interface NavStage {
  key: ViewKey;
  step: number | null; // funnel step number (null for overview/candidates)
  en: string;
  zh: string;
}

export const OVERVIEW: NavStage = { key: "overview", step: null, en: "Discovery Run", zh: "发现总览" };

export const FUNNEL: NavStage[] = [
  { key: "seeds", step: 1, en: "Seed Table", zh: "看多种子表" },
  { key: "heat", step: 2, en: "Heat Ignition", zh: "热度点火" },
  { key: "screen", step: 3, en: "Screen", zh: "发现筛选" },
  { key: "catalyst", step: 4, en: "Catalyst TPMN", zh: "催化剂 TPMN" },
  { key: "conviction", step: 5, en: "Conviction", zh: "管理层语气" },
  { key: "technical", step: 6, en: "Bollinger", zh: "Boll 技术" },
];

export const CANDIDATES: NavStage = {
  key: "candidates",
  step: null,
  en: "Finalists",
  zh: "通关候选",
};
