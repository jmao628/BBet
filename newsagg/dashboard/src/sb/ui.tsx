import type { ReactNode } from "react";
import { useT } from "../store";

export function ViewHead({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
          {eyebrow}
        </div>
        <h2 className="font-disp text-[22px] font-semibold tracking-tight">{title}</h2>
        {desc && <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  sub,
  right,
  pad0,
  children,
}: {
  title?: string;
  sub?: string;
  right?: ReactNode;
  pad0?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-line bg-panel ${pad0 ? "overflow-hidden" : "p-[18px]"}`}>
      {title && (
        <div
          className={`flex items-center justify-between ${pad0 ? "border-b border-line px-[18px] py-4" : "mb-3.5"}`}
        >
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {sub && <span className="text-[11px] text-muted2">{sub}</span>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatStrip({
  stats,
}: {
  stats: { k: string; v: ReactNode; d?: string; color?: string }[];
}) {
  return (
    <div className="mb-[18px] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      {stats.map((s) => (
        <div key={s.k} className="rounded-[11px] border border-line bg-panel px-4 py-3.5">
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted2">{s.k}</div>
          <div className="font-disp text-[26px] font-semibold leading-none" style={{ color: s.color }}>
            {s.v}
          </div>
          {s.d && <div className="mt-1.5 text-[11.5px] text-muted">{s.d}</div>}
        </div>
      ))}
    </div>
  );
}

const CHIP_CLS: Record<string, string> = {
  dead: "text-dead border-dead/40 bg-dead/10",
  ignite: "text-ignite border-ignite/45 bg-ignite/10",
  detonate: "text-detonate border-detonate/45 bg-detonate/10",
  ultralow: "text-muted2 border-line bg-inset",
  ok: "text-ok border-ok/40 bg-ok/10",
  wait: "text-muted2 border-line bg-inset",
  no: "text-bad border-bad/40 bg-bad/10",
  signal: "text-signal border-signal/40 bg-signal/10",
  gold: "text-gold border-gold/40 bg-gold/10",
};

export function Chip({ kind, children }: { kind: keyof typeof CHIP_CLS; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${CHIP_CLS[kind]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// Honest placeholder for a pipeline stage whose computation isn't wired yet.
export function Pending({ title, needs }: { title: string; needs: string[] }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-dashed border-line2 bg-panel2 p-6">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gold">
        <span>◷</span> {title}
      </div>
      <div className="mb-3 text-[12.5px] text-muted">
        {t("Structure is in place — fills in automatically once these are wired:", "结构已就位，等下面这些接入后自动填充：")}
      </div>
      <ul className="space-y-1.5">
        {needs.map((n, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] text-muted">
            <span className="text-muted2">›</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TickerCell({ ticker, company }: { ticker: string; company?: string }) {
  return (
    <div>
      <div className="font-mono text-[13px] font-semibold text-signal">{ticker}</div>
      {company && <div className="text-[11px] text-muted">{company}</div>}
    </div>
  );
}
