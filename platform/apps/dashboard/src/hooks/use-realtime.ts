import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useRealtime() {
  const queryClient = useQueryClient();
  const reconnects = useRef(0);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer: number | undefined;
    let stopped = false;
    const base = (import.meta.env.VITE_WS_URL ?? "ws://localhost:5005").replace(/\/$/, "");
    const notificationsUrl = base.endsWith("/ws") ? base : `${base}/ws`;
    const connect = () => {
      socket = new WebSocket(notificationsUrl);
      socket.onopen = () => {
        const wasReconnect = reconnects.current > 0;
        reconnects.current = 0;
        if (wasReconnect) void queryClient.invalidateQueries();
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as { type?: string };
          if (message.type === "detection.created") void queryClient.invalidateQueries({ queryKey: ["detections"] });
          if (message.type === "counting.updated") void queryClient.invalidateQueries({ queryKey: ["statistics"] });
          if (message.type === "camera.status_changed") void queryClient.invalidateQueries({ queryKey: ["cameras"] });
        } catch { /* Ignore malformed notification payloads. REST remains authoritative. */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        const delay = Math.min(30_000, 1_000 * 2 ** reconnects.current++);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); socket?.close(); };
  }, [queryClient]);
}
