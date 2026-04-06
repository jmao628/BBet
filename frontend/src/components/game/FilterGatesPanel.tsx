import type { FilterGate } from "../../types/api";
import Panel from "../shared/Panel";
import { CheckCircle2, XCircle } from "lucide-react";

export default function FilterGatesPanel({ gates }: { gates: FilterGate[] }) {
  const passCount = gates.filter((g) => g.passed).length;
  return (
    <Panel
      title="Filter Gates"
      headerRight={
        <span className="text-[10px] text-zinc-500">
          {passCount}/{gates.length} passed
        </span>
      }
    >
      <div className="space-y-1">
        {gates.map((g) => (
          <div key={g.gate_name} className="flex items-center justify-between text-xs py-0.5">
            <div className="flex items-center gap-1.5">
              {g.passed ? (
                <CheckCircle2 size={12} className="text-green-500" />
              ) : (
                <XCircle size={12} className="text-red-500" />
              )}
              <span className={g.passed ? "text-zinc-300" : "text-red-400"}>{g.gate_name}</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-500 tabular-nums">
              <span>{g.actual_value}</span>
              <span className="text-zinc-600">{g.threshold}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
