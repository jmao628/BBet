import { Panel, EmptyState, ComingSoon } from "./Panel";

// Placeholder for live captions (Schwab broadcast transcript) + extracted
// trade signals. Needs a streaming caption source; wired later via WS/SSE.
export function CaptionSignalPanel() {
  return (
    <Panel title="Live Caption & Signal" accent="#a78bfa" right={<ComingSoon source="Captions" />}>
      <EmptyState
        label="No live captions"
        hint="rolling transcript + detected tickers/signals will stream here"
      />
    </Panel>
  );
}
