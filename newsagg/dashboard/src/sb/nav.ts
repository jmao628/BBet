import type { ViewKey } from "../store";

// The funnel's backbone. Step 2 is a *parallel pair*, not a sequence: Heat
// (attention net) and Screen (quality net) are two independent lenses over the
// same seed pool — later stages take names that clear both. They share step 2.
export interface NavStage {
  key: ViewKey;
  step: number | null; // funnel step number (null for overview/candidates)
  en: string;
  zh: string;
  hint?: { en: string; zh: string }; // small tag, e.g. which lens a parallel branch is
}

export const OVERVIEW: NavStage = { key: "overview", step: null, en: "Discovery Run", zh: "发现总览" };

export const FUNNEL: NavStage[] = [
  { key: "seeds", step: 1, en: "Seed Table", zh: "看多种子表" },
  { key: "heat", step: 2, en: "Heat Ignition", zh: "热度点火", hint: { en: "attention · vol+social", zh: "被关注 · 量价+社交" } },
  { key: "screen", step: 2, en: "Screen", zh: "发现筛选", hint: { en: "quality · rating+thesis", zh: "质量 · 评分+论点" } },
  { key: "catalyst", step: 3, en: "Catalyst TPMN", zh: "催化剂 TPMN" },
  { key: "conviction", step: 4, en: "Conviction", zh: "管理层语气" },
  { key: "technical", step: 5, en: "Bollinger", zh: "Boll 技术" },
];

export const CANDIDATES: NavStage = {
  key: "candidates",
  step: null,
  en: "Finalists",
  zh: "通关候选",
};
