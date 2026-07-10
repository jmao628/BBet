import { useStore } from "../store";
import { buildSeeds, buildScreen, buildRankings } from "./pipeline";
import { OVERVIEW, FUNNEL, CANDIDATES, type NavStage } from "./nav";

// Funnel counts. Seeds + heat-ignition are real; the rest show "—" until
// their computations are wired.
function useCounts(): Record<string, number | null> {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const marketCaps = useStore((s) => s.marketCaps);
  const seeds = buildSeeds(data);

  // Stage 2 advances the union of every ranking lens's top-N (+ mega caps).
  let heatCount: number | null = null;
  if (heat || technical) {
    heatCount = buildRankings(data, heat, technical, marketCaps).advancing.size;
  }

  const screenCount =
    heat || technical ? buildScreen(data, heat, marketCaps, technical).candidates.length : null;

  return {
    seeds: seeds.length,
    heat: heatCount,
    screen: screenCount,
    catalyst: null,
    conviction: null,
    technical: null,
    candidates: null,
  };
}

function NavRow({ stage, count }: { stage: NavStage; count: number | null }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const active = view === stage.key;
  return (
    <button
      onClick={() => setView(stage.key)}
      className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
        active ? "text-text" : "text-muted hover:bg-[#0E141D] hover:text-text"
      }`}
    >
      {active && <span className="absolute left-0 h-6 w-[3px] rounded-r bg-signal" />}
      {stage.step != null && (
        <span
          className={`grid h-5 w-5 flex-none place-items-center rounded-full border text-[10px] font-semibold ${
            active ? "border-signal bg-signal text-ink" : "border-line2 text-muted2"
          }`}
        >
          {stage.step}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{stage.lbl}</span>
        <span className="block text-[10px] text-muted2">{stage.sub}</span>
      </span>
      <span className="font-mono text-[13px] font-semibold text-text">
        {count == null ? <span className="text-muted2">—</span> : count}
      </span>
    </button>
  );
}

export function FunnelRail() {
  const counts = useCounts();
  return (
    <aside className="relative overflow-y-auto border-r border-line bg-panel2 py-4">
      <div className="relative">
        <NavRow stage={OVERVIEW} count={null} />
      </div>

      <div className="px-5 pb-2 pt-4 text-[10.5px] uppercase tracking-[0.14em] text-muted2">
        发现漏斗 · Funnel
      </div>
      {FUNNEL.map((s) => (
        <div key={s.key} className="relative">
          <NavRow stage={s} count={counts[s.key]} />
        </div>
      ))}

      <div className="mx-5 my-3 border-t border-line" />
      <div className="relative">
        <NavRow stage={CANDIDATES} count={counts.candidates} />
      </div>
    </aside>
  );
}
