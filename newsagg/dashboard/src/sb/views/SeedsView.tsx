import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { buildSeeds, CATALYST_CN, ROLE_CN, type CatalystType } from "../pipeline";
import { ViewHead, Card, Chip } from "../ui";

const CATS: (CatalystType | "all")[] = [
  "all",
  "earnings",
  "guidance",
  "new_order",
  "policy",
  "m_and_a",
  "other",
];

export function SeedsView() {
  const data = useStore((s) => s.data);
  const seeds = useMemo(() => buildSeeds(data), [data]);
  const [src, setSrc] = useState("all");
  const [cat, setCat] = useState<CatalystType | "all">("all");

  const sources = useMemo(() => ["all", ...new Set(seeds.map((r) => r.src))], [seeds]);
  const rows = seeds.filter(
    (r) => (src === "all" || r.src === src) && (cat === "all" || r.catalyst === cat),
  );

  return (
    <div>
      <ViewHead
        eyebrow="Stage 1 · 采集"
        title="当日看多种子表"
        desc="LLM 强制结构化输出 JSON（is_bull / ticker / reasoning / evidence / catalyst_type / role）；is_bull=false 或无 ticker 已丢弃 → 表内全为看多。按「同 ticker + 同 catalyst + 相近日期」去重，并挂 author_weight（白名单外为 0）。"
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Seg items={sources} value={src} onChange={setSrc} labels={{ all: "全部源" }} />
        <Seg
          items={CATS}
          value={cat}
          onChange={(v) => setCat(v as CatalystType | "all")}
          labels={{ all: "全部催化剂", ...CATALYST_CN }}
        />
        <span className="ml-auto font-mono text-[12px] text-muted2">{rows.length} 条</span>
      </div>

      <div className="mb-3 rounded-lg border border-line2/60 bg-panel2 px-3 py-2 text-[11.5px] text-muted">
        当前来自 SeekingAlpha「Most Compelling Analyst Ideas」（作者 + 文章 + 评级）。
        <span className="text-muted2">
          {" "}
          catalyst / role / evidence / followers / author_weight 待 LLM 归一步骤接入。
        </span>
      </div>

      <Card pad0>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">
            暂无种子。运行抓取器后，SeekingAlpha 的看多观点会出现在这里。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted2">
                  <Th>源</Th>
                  <Th>日期</Th>
                  <Th>作者</Th>
                  <Th right>Followers</Th>
                  <Th>标的</Th>
                  <Th>Reasoning</Th>
                  <Th>Catalyst</Th>
                  <Th>Role</Th>
                  <Th right>Weight</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-muted">
                        {r.src}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-muted">{r.date ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.author ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted2">
                      {r.followers ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-semibold text-signal">{r.ticker}</div>
                      <div className="text-[11px] text-muted">{r.company}</div>
                    </td>
                    <td className="max-w-[320px] px-3 py-2.5">
                      <div className="truncate text-[12.5px]">{r.reasoning || "—"}</div>
                      {r.rating && (
                        <span className="text-[10px] font-semibold text-ok">{r.rating}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip kind={r.catalyst === "unknown" ? "wait" : "signal"}>
                        {CATALYST_CN[r.catalyst]}
                      </Chip>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{ROLE_CN[r.role]}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted2">
                      {r.weight ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}

function Seg({
  items,
  value,
  onChange,
  labels,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-line">
      {items.map((it) => (
        <button
          key={it}
          onClick={() => onChange(it)}
          className={`px-3 py-1.5 text-[12px] transition-colors ${
            value === it ? "bg-signal/15 text-signal" : "text-muted hover:text-text"
          }`}
        >
          {labels?.[it] ?? it}
        </button>
      ))}
    </div>
  );
}
