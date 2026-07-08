import { useEffect, useState } from "react";
import { Panel, EmptyState } from "./Panel";

interface DashCfg {
  schwabChannelId?: string; // YouTube channel id (UC...) of Schwab Network
}

// Embeds the Schwab Network YouTube live stream. The channel id comes from a
// local, user-editable config (data/newsagg/dashboard.json) so you can set it
// without rebuilding. YouTube's channel live-stream embed auto-follows whatever
// broadcast is currently live on that channel.
export function SchwabStreamPanel() {
  const [cfg, setCfg] = useState<DashCfg | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/data/newsagg/dashboard.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((c: DashCfg) => setCfg(c))
      .catch(() => setCfg({}))
      .finally(() => setLoaded(true));
  }, []);

  const channel = cfg?.schwabChannelId?.trim();

  return (
    <Panel title="Schwab Live Stream" accent="#38bdf8">
      {!loaded ? null : channel ? (
        <div className="h-full w-full bg-black">
          <iframe
            title="Schwab Network Live"
            className="h-full w-full border-0"
            src={`https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(
              channel,
            )}&autoplay=1&mute=1`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ) : (
        <EmptyState
          label="Set your Schwab channel to embed the live stream"
          hint="create data/newsagg/dashboard.json with your channel id — see README"
        />
      )}
    </Panel>
  );
}
