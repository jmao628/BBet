import { useEffect, useRef, useState, useCallback } from "react";

export interface LivePrice {
  event_id: string;
  ticker: string;
  title: string;
  team: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  ts: string;
}

interface PriceUpdate {
  type: "price_update";
  ts: string;
  prices: LivePrice[];
}

const WS_URL = (window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host + "/ws/prices";
const RECONNECT_DELAY = 2000;

/**
 * WebSocket hook for real-time price streaming from Kalshi.
 * Auto-reconnects on disconnect. Updates every ~1.5 seconds.
 */
export function useLivePrices() {
  const [prices, setPrices] = useState(new Map<string, LivePrice>());
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
      };

      ws.onmessage = (event) => {
        try {
          const data: PriceUpdate = JSON.parse(event.data);
          if (data.type === "price_update" && data.prices) {
            setPrices(prev => {
              const next = new Map(prev);
              for (const p of data.prices) {
                next.set(p.ticker, p);
              }
              return next;
            });
            setLastUpdate(data.ts);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  // Helper: get price for a specific ticker
  const getPrice = useCallback((ticker: string) => prices.get(ticker), [prices]);

  // Helper: get all prices for an event (game)
  const getGamePrices = useCallback((eventId: string) => {
    const result: LivePrice[] = [];
    for (const p of prices.values()) {
      if (p.event_id === eventId) result.push(p);
    }
    return result;
  }, [prices]);

  return { prices, connected, lastUpdate, getPrice, getGamePrices };
}
