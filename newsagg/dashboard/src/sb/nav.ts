import type { ViewKey } from "../store";

// The funnel is the product's backbone: seed table → heat → screen → catalyst
// → conviction → technical, bracketed by an overview and the final candidates.
export interface NavStage {
  key: ViewKey;
  step: number | null; // funnel step number (null for overview/candidates)
  lbl: string;
  sub: string;
}

export const OVERVIEW: NavStage = { key: "overview", step: null, lbl: "发现总览", sub: "Discovery run" };

export const FUNNEL: NavStage[] = [
  { key: "seeds", step: 1, lbl: "看多种子表", sub: "Seed table" },
  { key: "heat", step: 2, lbl: "热度点火", sub: "Heat ignition" },
  { key: "screen", step: 3, lbl: "发现筛选", sub: "Screen" },
  { key: "catalyst", step: 4, lbl: "催化剂 TPMN", sub: "Catalyst score" },
  { key: "conviction", step: 5, lbl: "Conviction", sub: "Mgmt tone" },
  { key: "technical", step: 6, lbl: "Boll 技术", sub: "Technical" },
];

export const CANDIDATES: NavStage = {
  key: "candidates",
  step: null,
  lbl: "通关候选",
  sub: "Finalists · 五闸全过",
};
