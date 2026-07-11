import { useStore } from "../store";
import { buildSeeds, buildScreen, buildRankings, buildFocus, noDataSet } from "./pipeline";
import { OVERVIEW, FUNNEL, FOCUS, CANDIDATES, type NavStage } from "./nav";

// Funnel counts. Seeds + heat-ignition are real; the rest show "—" until
// their computations are wired.
function useCounts(): Record<string, number | null> {
  const data = useStore((s) => s.data);
  const heat = useStore((s) => s.heat);
  const technical = useStore((s) => s.technical);
  const sectors = useStore((s) => s.sectors);
  const supplychain = useStore((s) => s.supplychain);
  const marketCaps = useStore((s) => s.marketCaps);
  // Exclude only CONFIRMED no-data OTC/foreign ADRs (pending new seeds still count).
  const noData = noDataSet(technical);
  const seeds = buildSeeds(data).filter((r) => !noData.has(r.ticker));

  // Stage 2 advances the union of every ranking lens's top-N (+ mega caps).
  let heatCount: number | null = null;
  if (heat || technical) {
    heatCount = buildRankings(data, heat, technical, marketCaps).advancing.size;
  }

  const screenCount =
    heat || technical ? buildScreen(data, heat, marketCaps, technical).candidates.length : null;

  const focusCount =
    technical || supplychain
      ? buildFocus(data, heat, technical, marketCaps, sectors, supplychain).length
      : null;

  return {
    seeds: seeds.length,
    heat: heatCount,
    screen: screenCount,
    focus: focusCount,
    catalyst: null,
    conviction: null,
    technical: null,
    candidates: null,
  };
}

function NavRow({
  stage,
  count,
  branch,
}: {
  stage: NavStage;
  count: number | null;
  branch?: boolean; // a parallel branch that shares the step number of the row above
}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lang = useStore((s) => s.lang);
  const active = view === stage.key;
  const primary = lang === "zh" ? stage.zh : stage.en;
  const hint = stage.hint ? (lang === "zh" ? stage.hint.zh : stage.hint.en) : lang === "zh" ? stage.en : stage.zh;
  return (
    <button
      onClick={() => setView(stage.key)}
      className={`relative flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
        active ? "text-text" : "text-muted hover:bg-[#0E141D] hover:text-text"
      }`}
    >
      {active && <span className="absolute left-0 h-6 w-[3px] rounded-r bg-signal" />}
      {stage.step != null &&
        (branch ? (
          // parallel branch: a dot connected up to the numbered row above it
          <span className="relative grid h-5 w-5 flex-none place-items-center">
            <span className="absolute left-1/2 bottom-1/2 h-[18px] w-px -translate-x-1/2 bg-line2" />
            <span className={`z-[1] h-2 w-2 rounded-full ${active ? "bg-signal" : "border border-line2 bg-panel2"}`} />
          </span>
        ) : (
          <span
            className={`grid h-5 w-5 flex-none place-items-center rounded-full border text-[10px] font-semibold transition-colors ${
              active ? "border-signal bg-signal text-ink" : "border-line2 text-muted2"
            }`}
          >
            {stage.step}
          </span>
        ))}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{primary}</span>
        <span className="block text-[10px] text-muted2">{hint}</span>
      </span>
      <span className="font-mono text-[13px] font-semibold text-text">
        {count == null ? <span className="text-muted2">—</span> : count}
      </span>
    </button>
  );
}

export function FunnelRail() {
  const counts = useCounts();
  const lang = useStore((s) => s.lang);
  return (
    <aside className="relative overflow-y-auto border-r border-line bg-panel2 py-4">
      <div className="relative">
        <NavRow stage={OVERVIEW} count={null} />
      </div>

      <div className="px-5 pb-2 pt-4 text-[10.5px] uppercase tracking-[0.14em] text-muted2">
        {lang === "zh" ? "发现漏斗 · Funnel" : "Discovery Funnel"}
      </div>
      {FUNNEL.map((s, i) => (
        <div key={s.key} className="relative">
          {/* a stage that repeats the previous stage's number is a parallel branch */}
          <NavRow stage={s} count={counts[s.key]} branch={i > 0 && FUNNEL[i - 1].step === s.step} />
          {/* the synthesized step-2 output sits right after the Heat/Screen pair */}
          {s.key === "screen" && (
            <div className="relative bg-gradient-to-r from-signal/[0.06] to-transparent">
              <NavRow stage={FOCUS} count={counts.focus} />
            </div>
          )}
        </div>
      ))}

      <div className="mx-5 my-3 border-t border-line" />
      <div className="relative">
        <NavRow stage={CANDIDATES} count={counts.candidates} />
      </div>
    </aside>
  );
}
