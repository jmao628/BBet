import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { ProbabilityBreakdown } from "../../types/api";
import Panel from "../shared/Panel";
import { pct } from "../../lib/format";

const COLORS: Record<string, string> = {
  Sportsbook: "#f59e0b",
  Model: "#3b82f6",
  Market: "#8b5cf6",
  "Fair Prob": "#10b981",
};

export default function ProbabilityPanel({ prob }: { prob: ProbabilityBreakdown }) {
  const bars = [
    { name: "Sportsbook", value: prob.sportsbook_novig },
    { name: "Model", value: prob.model_calibrated ?? prob.model_raw },
    { name: "Market", value: prob.market_mid },
    { name: "Fair Prob", value: prob.ensemble_fair },
  ].filter((b) => b.value != null);

  return (
    <Panel title="Fair Probability Breakdown">
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} layout="vertical" margin={{ left: 70, right: 20, top: 5, bottom: 5 }}>
            <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => pct(v, 0)} tick={{ fill: "#71717a", fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} width={65} />
            <Tooltip
              formatter={(v) => pct(Number(v))}
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
              labelStyle={{ color: "#a1a1aa" }}
            />
            {prob.ensemble_fair != null && (
              <ReferenceLine x={prob.ensemble_fair} stroke="#10b981" strokeDasharray="3 3" />
            )}
            <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={18}>
              {bars.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name] ?? "#71717a"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* CI display */}
      {prob.ci_lower != null && prob.ci_upper != null && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
          <span>95% CI:</span>
          <span className="tabular-nums">
            [{pct(prob.ci_lower)} — {pct(prob.ci_upper)}]
          </span>
          <span className="text-zinc-600">
            width: {pct(prob.ci_upper - prob.ci_lower)}
          </span>
        </div>
      )}
    </Panel>
  );
}
