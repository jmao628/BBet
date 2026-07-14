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
  { key: "shortlist", step: 4, en: "Shortlist", zh: "登顶广度", hint: { en: "top across 3 lenses", zh: "三维登顶 · 交集精选" } },
  { key: "conviction", step: 5, en: "Conviction", zh: "管理层语气" },
];

// The synthesized output of step 2 — strong-buy × ecosystem, the shortlist that
// carries into the deeper stages. Rendered as a highlighted output node.
export const FOCUS: NavStage = {
  key: "focus",
  step: null,
  en: "Focus List",
  zh: "重点名单",
  hint: { en: "strong-buy × ecosystem", zh: "强买 × 生态 · 交集" },
};

// The synthesis at the Conviction gate — Tier-1/2 names past Conviction 6,
// ranked by conviction. The funnel's terminal output node.
export const RANKING: NavStage = {
  key: "ranking",
  step: null,
  en: "Composite Rank",
  zh: "综合排行",
  hint: { en: "Tier-1/2 · conviction > 6", zh: "金/银档 · 语气 > 6" },
};
