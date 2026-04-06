import type { InjuryDetail } from "../../types/api";
import Panel from "../shared/Panel";
import Badge from "../shared/Badge";
import { num } from "../../lib/format";

interface Props {
  homeTeam: string;
  awayTeam: string;
  homeInjuries: InjuryDetail[];
  awayInjuries: InjuryDetail[];
}

const STATUS_COLOR: Record<string, string> = {
  Out: "text-red-400 bg-red-400/10",
  Doubtful: "text-orange-400 bg-orange-400/10",
  Questionable: "text-yellow-400 bg-yellow-400/10",
  Probable: "text-zinc-400 bg-zinc-400/10",
  "Game Time Decision": "text-yellow-400 bg-yellow-400/10",
};

export default function InjuryPanel({ homeTeam, awayTeam, homeInjuries, awayInjuries }: Props) {
  const noInjuries = homeInjuries.length === 0 && awayInjuries.length === 0;

  return (
    <Panel title="Injury Report">
      {noInjuries ? (
        <div className="text-xs text-zinc-600 text-center py-2">No injuries reported</div>
      ) : (
        <div className="space-y-3">
          {[
            { team: awayTeam, injuries: awayInjuries },
            { team: homeTeam, injuries: homeInjuries },
          ].map(({ team, injuries }) =>
            injuries.length > 0 ? (
              <div key={team}>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{team}</div>
                <div className="space-y-1">
                  {injuries.map((inj) => (
                    <div key={inj.player_name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={inj.is_star ? "text-zinc-100 font-medium" : "text-zinc-300"}>
                          {inj.player_name}
                          {inj.is_star && " ★"}
                        </span>
                        <Badge text={inj.status} color={STATUS_COLOR[inj.status] ?? "text-zinc-400 bg-zinc-800"} />
                      </div>
                      <div className="flex items-center gap-3 text-zinc-500">
                        <span title="BPM">BPM {num(inj.bpm, 1)}</span>
                        <span title="Impact Weight">Impact {num(inj.impact_weight, 2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </Panel>
  );
}
