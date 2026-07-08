import type { ReactNode } from "react";

// A panel = sticky header + its own scroll body. Each fills its grid cell so
// every column/row region scrolls independently.
export function Panel({
  title,
  accent,
  right,
  children,
}: {
  title: string;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-term-border bg-term-panel px-3 py-2">
        {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-term-muted">
          {title}
        </h2>
        <div className="ml-auto">{right}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <div className="text-sm text-term-muted">{label}</div>
      {hint && <div className="text-[11px] text-term-muted/60">{hint}</div>}
    </div>
  );
}

// Small pill for a source that has no live feed connected yet.
export function ComingSoon({ source }: { source: string }) {
  return (
    <span className="rounded border border-term-border px-1.5 py-0.5 text-[10px] text-term-muted">
      {source} · not wired yet
    </span>
  );
}
