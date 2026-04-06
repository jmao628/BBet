import type { MarketContractInfo } from "../../types/api";
import Panel from "../shared/Panel";
import Badge from "../shared/Badge";
import { pct, usd, num } from "../../lib/format";

export default function MarketPanel({ markets }: { markets: MarketContractInfo[] }) {
  if (markets.length === 0) {
    return (
      <Panel title="Markets">
        <div className="text-xs text-zinc-600 text-center py-2">No open markets</div>
      </Panel>
    );
  }

  return (
    <Panel title="Markets">
      <div className="space-y-2">
        {markets.map((m) => (
          <div key={m.contract_id} className="p-2 bg-zinc-800/40 rounded">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Badge text={m.platform} />
                <Badge text={m.market_type} />
              </div>
              <Badge
                text={m.status}
                color={m.status === "open" ? "text-green-400 bg-green-400/10" : "text-zinc-500 bg-zinc-800"}
              />
            </div>
            <div className="text-xs text-zinc-400 mb-2">{m.question}</div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-[10px] text-zinc-600">Bid</div>
                <div className="tabular-nums">{pct(m.yes_bid)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-600">Ask</div>
                <div className="tabular-nums">{pct(m.yes_ask)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-600">Spread</div>
                <div className="tabular-nums">{num(m.spread, 3)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-600">Vol 24h</div>
                <div className="tabular-nums">{m.volume_24h != null ? usd(m.volume_24h) : "—"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
