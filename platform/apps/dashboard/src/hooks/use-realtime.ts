import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getOperatorToken } from "../lib/api";

export function useRealtime() {
  const queryClient = useQueryClient();
  const reconnects = useRef(0);
  const [operatorToken, setToken] = useState(getOperatorToken);

  useEffect(() => { const update = () => setToken(getOperatorToken()); window.addEventListener("operator-token-changed", update); return () => window.removeEventListener("operator-token-changed", update); }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer: number | undefined;
    let stopped = false;
    const base = (import.meta.env.VITE_WS_URL ?? "ws://localhost:5005").replace(/\/$/, "");
    const notificationsUrl = base.endsWith("/ws") ? base : `${base}/ws`;
    const operatorProtocol = operatorToken ? `cctv-operator.${btoa(String.fromCharCode(...new TextEncoder().encode(operatorToken))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` : undefined;
    const connect = () => {
      socket = operatorProtocol ? new WebSocket(notificationsUrl, operatorProtocol) : new WebSocket(notificationsUrl);
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
          if (message.type === "identity.verified") void queryClient.invalidateQueries({ queryKey: ["active-identities"] });
          if (message.type === "person_capture.created") {
            void queryClient.invalidateQueries({ queryKey: ["person-captures"] });
            window.dispatchEvent(new CustomEvent("person-capture-created", { detail: message }));
          }
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
  }, [operatorToken, queryClient]);
}
