import { useEffect, useMemo, useRef } from "react";

type Handler = (payload: any) => void;

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(new Map<string, Set<Handler>>());
  const queueRef = useRef<any[]>([]);
  const disposedRef = useRef(false);

  const connectRef = useRef<() => void>(() => {});
  connectRef.current = () => {
    if (disposedRef.current) return;
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
      // 只有「当前这条」断了才重连;被替换/组件卸载时不再拉起僵尸连接
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!disposedRef.current) setTimeout(() => connectRef.current(), 1000);
    });
    ws.addEventListener("error", () => ws.close());
  };

  useEffect(() => {
    disposedRef.current = false;
    connectRef.current();
    return () => {
      disposedRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // 返回值必须**恒定**:调用方把它放进 effect 依赖(socket.on/off 成对挂拆)。
  // 从前每次渲染返回新对象 → 依赖它的 effect 每渲染重跑,cleanup 把节流中的
  // 定时器一并清掉,事件被静默吞没 —— 树收到 tree_changed 却纹丝不动的元凶。
  return useMemo(() => ({
    send: (msg: any) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else queueRef.current.push(msg);
    },
    on: (type: string, fn: Handler) => {
      const map = handlersRef.current;
      const set = map.get(type) || new Set();
      set.add(fn);
      map.set(type, set);
      return () => { set.delete(fn); if (!set.size) map.delete(type); };
    },
  }), []);
}
