import { useCallback, useEffect, useRef } from "react";

type Handler = (payload: any) => void;

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(new Map<string, Set<Handler>>());
  const queueRef = useRef<any[]>([]);

  const connect = useCallback(() => {
    const url = new URL("/api/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      for (const msg of queueRef.current.splice(0)) ws.send(JSON.stringify(msg));
    });
    ws.addEventListener("message", (e) => {
      const payload = JSON.parse(String(e.data));
      const handlers = handlersRef.current.get(payload.type);
      if (handlers) handlers.forEach((fn) => fn(payload));
    });
    ws.addEventListener("close", () => {
      wsRef.current = null;
      setTimeout(connect, 1000);
    });
    ws.addEventListener("error", () => ws.close());
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); wsRef.current = null; };
  }, [connect]);

  const send = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else queueRef.current.push(msg);
  }, []);

  const on = useCallback((type: string, fn: Handler) => {
    const map = handlersRef.current;
    const set = map.get(type) || new Set();
    set.add(fn);
    map.set(type, set);
    return () => { set.delete(fn); if (!set.size) map.delete(type); };
  }, []);

  return { send, on };
}
