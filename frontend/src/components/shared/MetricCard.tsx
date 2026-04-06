import clsx from "clsx";

interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  className?: string;
}

export default function MetricCard({ label, value, sub, color, className }: Props) {
  return (
    <div className={clsx("bg-zinc-900 border border-zinc-800 rounded px-3 py-2", className)}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <div className={clsx("text-lg font-semibold tabular-nums", color ?? "text-zinc-100")}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}
