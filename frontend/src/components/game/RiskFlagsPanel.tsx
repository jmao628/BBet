import type { RiskFlag, KeyDriver } from "../../types/api";
import Panel from "../shared/Panel";
import Badge from "../shared/Badge";
import { severityColor, num } from "../../lib/format";
import { AlertTriangle, TrendingUp } from "lucide-react";

interface Props {
  riskFlags: RiskFlag[];
  keyDrivers: KeyDriver[];
}

export default function RiskFlagsPanel({ riskFlags, keyDrivers }: Props) {
  return (
    <div className="space-y-4">
      {/* Key Drivers */}
      <Panel title="Key Drivers">
        {keyDrivers.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center py-2">No key drivers extracted</div>
        ) : (
          <div className="space-y-1.5">
            {keyDrivers.map((d) => (
              <div key={d.factor} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-blue-400" />
                  <span className="text-zinc-300">{d.factor}</span>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="text-zinc-500">raw: {num(d.raw_value)}</span>
                  <span className={d.impact > 0 ? "text-green-400" : "text-red-400"}>
                    {d.impact > 0 ? "+" : ""}
                    {num(d.impact, 3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Risk Flags */}
      <Panel title="Risk Flags">
        {riskFlags.length === 0 ? (
          <div className="text-xs text-green-500/70 text-center py-2">No risk flags</div>
        ) : (
          <div className="space-y-1.5">
            {riskFlags.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle size={12} className="text-yellow-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-300">{f.flag}</span>
                    <Badge text={f.severity} color={severityColor(f.severity)} />
                  </div>
                  <div className="text-zinc-500 mt-0.5">{f.note}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
