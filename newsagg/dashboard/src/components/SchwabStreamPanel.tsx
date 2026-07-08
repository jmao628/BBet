import { useEffect, useState } from "react";
import { Panel, EmptyState } from "./Panel";

interface DashCfg {
  schwabChannelId?: string; // YouTube channel id (UC...) of Schwab Network
  schwabVideoId?: string | null; // resolved current live video id (null = offline)
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
  const videoId = cfg?.schwabVideoId?.trim();
  // The resolver (newsagg.schwab_live) sets schwabVideoId — a value when live,
  // null when it ran and found no live broadcast. We only fall back to the
  // flaky channel embed when the resolver hasn't run at all.
  const resolverRan = cfg != null && "schwabVideoId" in cfg;

  // Prefer the resolved live video (reliable); else the channel embed; else setup.
  const src = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`
    : !resolverRan && channel
      ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel)}&autoplay=1&mute=1`
      : null;

  return (
    <Panel title="Schwab Live Stream" accent="#38bdf8">
      {!loaded ? null : src ? (
        <div className="h-full w-full bg-black">
          <iframe
            title="Schwab Network Live"
            className="h-full w-full border-0"
            src={src}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ) : resolverRan && !videoId ? (
        <EmptyState
          label="Schwab Network is offline right now"
          hint="no live broadcast (usually live during US market hours)"
        />
      ) : (
        <EmptyState
          label="Set your Schwab channel to embed the live stream"
          hint="create data/newsagg/dashboard.json with your channel id — see README"
        />
      )}
    </Panel>
  );
}
