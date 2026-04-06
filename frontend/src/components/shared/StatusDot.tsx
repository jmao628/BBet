import clsx from "clsx";

export default function StatusDot({ status }: { status: string }) {
  const color =
    status === "ok" || status === "healthy"
      ? "bg-green-500"
      : status === "stale" || status === "degraded"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <span
      className={clsx("inline-block w-1.5 h-1.5 rounded-full", color)}
      title={status}
    />
  );
}
