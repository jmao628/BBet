import type { DecisionMetrics, ConfidenceInfo } from "../../types/api";
import Panel from "../shared/Panel";
import Badge from "../shared/Badge";
import { directionColor, pct, usd, tierColor, num } from "../../lib/format";

interface Props {
  decision: DecisionMetrics;
  confidence: ConfidenceInfo;
}

export default function DecisionPanel({ decision, confidence }: Props) {
  return (
    <Panel title="Decision & Sizing">
      {/* Direction banner */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold ${directionColor(decision.direction)}`}>
            {decision.direction}
          </span>
          <Badge text={confidence.tier} color={tierColor(confidence.tier)} />
        </div>
        <span className="text-xs text-zinc-500">
          Confidence: {num(confidence.score, 3)}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <Row label="Edge" value={pct(decision.edge)} highlight />
        <Row label="Expected Value" value={pct(decision.expected_value)} />
        <Row label="Kelly (full)" value={pct(decision.kelly_full)} />
        <Row label="Kelly (1/4)" value={pct(decision.kelly_suggested)} />
        <Row label="Suggested Size" value={usd(decision.suggested_size_usd)} highlight />
        <Row label="Max Size" value={usd(decision.max_size_usd)} />
        <Row label="Model Disagreement" value={num(confidence.model_disagreement, 3)} />
      </div>
    </Panel>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-zinc-500">{label}</span>
      <span className={highlight ? "text-zinc-100 font-medium tabular-nums" : "text-zinc-300 tabular-nums"}>
        {value}
      </span>
    </div>
  );
}
