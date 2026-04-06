import type { TeamStats } from "../../types/api";
import Panel from "../shared/Panel";
import { num, pct } from "../../lib/format";

interface Props {
  home: TeamStats;
  away: TeamStats;
}

const ROWS: { label: string; key: keyof TeamStats; format: "num" | "pct"; better: "high" | "low" }[] = [
  { label: "Net Rating", key: "net_rating", format: "num", better: "high" },
  { label: "Off Rating", key: "off_rating", format: "num", better: "high" },
  { label: "Def Rating", key: "def_rating", format: "num", better: "low" },
  { label: "Pace", key: "pace", format: "num", better: "high" },
  { label: "eFG%", key: "efg_pct", format: "pct", better: "high" },
  { label: "TS%", key: "ts_pct", format: "pct", better: "high" },
  { label: "TOV%", key: "tov_pct", format: "num", better: "low" },
  { label: "Elo", key: "elo", format: "num", better: "high" },
  { label: "Last 5 Net", key: "last5_net", format: "num", better: "high" },
  { label: "Last 10 Net", key: "last10_net", format: "num", better: "high" },
  { label: "Home/Road Net", key: "home_net", format: "num", better: "high" },
  { label: "Win Streak", key: "win_streak", format: "num", better: "high" },
  { label: "Rest Days", key: "rest_days", format: "num", better: "high" },
];

export default function TeamComparisonPanel({ home, away }: Props) {
  return (
    <Panel title="Team Comparison">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-500">
            <th className="text-left py-1 font-normal">Metric</th>
            <th className="text-right py-1 font-normal">{away.team_abbr}</th>
            <th className="text-right py-1 font-normal">{home.team_abbr}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ label, key, format, better }) => {
            const hv = home[key] as number;
            const av = away[key] as number;
            const homeBetter =
              better === "high" ? hv > av : hv < av;
            const awayBetter = !homeBetter && hv !== av;

            const fmt = (v: number) =>
              format === "pct" ? pct(v) : num(v, 1);

            return (
              <tr key={key} className="border-t border-zinc-800/50">
                <td className="py-1 text-zinc-400">{label}</td>
                <td className={`text-right py-1 tabular-nums ${awayBetter ? "text-green-400" : "text-zinc-300"}`}>
                  {fmt(av)}
                </td>
                <td className={`text-right py-1 tabular-nums ${homeBetter ? "text-green-400" : "text-zinc-300"}`}>
                  {fmt(hv)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
