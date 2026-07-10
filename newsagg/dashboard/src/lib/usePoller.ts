import { useEffect } from "react";
import { useStore } from "../store";
import type { HeatData, Health, SAData } from "../types";

// The scraped snapshot. Served same-origin by the local http.server (built) or
// proxied by Vite in dev. Data updates daily today; polling is the pragmatic
// "realtime" until a streaming source (Schwab/X) is wired to a WS/SSE endpoint.
const DATA_URL = "/data/newsagg/seekingalpha_latest.json";
const HEAT_URL = "/data/newsagg/heat_latest.json";
const HEALTH_URL = "/data/newsagg/health.json";
const POLL_MS = 15_000;
const STALE_MS = 36 * 60 * 60 * 1000; // flag data older than ~1.5 days

export function usePoller() {
  const setData = useStore((s) => s.setData);
  const setHeat = useStore((s) => s.setHeat);
  const setHealth = useStore((s) => s.setHealth);
  const setStatus = useStore((s) => s.setStatus);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SAData;
        if (!alive) return;
        setData(json);
        if (json.generated_at) {
          const age = Date.now() - new Date(json.generated_at).getTime();
          if (age > STALE_MS) setStatus("stale");
        }
      } catch {
        if (alive) setStatus("error");
      }
      // Heat + health are best-effort; absent files just mean no data yet.
      try {
        const hres = await fetch(`${HEAT_URL}?t=${Date.now()}`);
        if (alive) setHeat(hres.ok ? ((await hres.json()) as HeatData) : null);
      } catch {
        /* ignore */
      }
      try {
        const hres = await fetch(`${HEALTH_URL}?t=${Date.now()}`);
        if (alive) setHealth(hres.ok ? ((await hres.json()) as Health) : null);
      } catch {
        /* ignore */
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setData, setHeat, setHealth, setStatus]);
}
