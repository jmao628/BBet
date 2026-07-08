import { Panel, EmptyState, ComingSoon } from "./Panel";

// Placeholder for the Schwab Network live video stream. The collector exists
// (newsagg/collectors/schwab_youtube.py) but isn't wired into the dashboard
// feed yet; this panel is structured to accept the latest videos + a live
// embed once that source is connected via WS/SSE.
export function SchwabStreamPanel() {
  return (
    <Panel title="Schwab Live Stream" accent="#38bdf8" right={<ComingSoon source="Schwab" />}>
      <EmptyState
        label="No live Schwab stream connected"
        hint="YouTube collector will feed latest videos + transcripts here"
      />
    </Panel>
  );
}
