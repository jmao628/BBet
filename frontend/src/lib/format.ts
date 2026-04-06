/** Formatting utilities for the terminal UI. */

export function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

export function pctRaw(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(decimals)}%`;
}

export function usd(v: number | null | undefined, decimals = 0): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function num(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

export function edgeColor(edge: number): string {
  if (edge >= 0.08) return "text-green-400";
  if (edge >= 0.04) return "text-green-300";
  if (edge > 0) return "text-yellow-400";
  return "text-zinc-500";
}

export function tierColor(tier: string): string {
  switch (tier) {
    case "HIGH":
      return "text-green-400 bg-green-400/10";
    case "MED":
      return "text-yellow-400 bg-yellow-400/10";
    case "LOW":
      return "text-zinc-400 bg-zinc-400/10";
    default:
      return "text-zinc-500";
  }
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "HIGH":
    case "CRITICAL":
    case "ERROR":
      return "text-red-400 bg-red-400/10";
    case "MEDIUM":
    case "WARNING":
      return "text-yellow-400 bg-yellow-400/10";
    case "LOW":
    case "INFO":
      return "text-zinc-400 bg-zinc-400/10";
    default:
      return "text-zinc-500";
  }
}

export function directionColor(dir: string): string {
  if (dir === "YES") return "text-green-400";
  if (dir === "NO") return "text-red-400";
  return "text-zinc-500";
}

export function statusColor(status: string): string {
  switch (status) {
    case "ok":
    case "healthy":
      return "text-green-400";
    case "stale":
    case "degraded":
      return "text-yellow-400";
    case "error":
    case "critical":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function gameTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
