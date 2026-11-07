import { useEffect, useRef, useState, type RefObject } from "react";

export type LivePreviewStatus = "connecting" | "live" | "reconnecting" | "offline" | "error";
export interface VisibleObjectCounts { person: number; car: number; motorcycle: number }
export interface VisibleTrack { trackId: number; objectType: "person" | "car" | "motorcycle"; bbox: [number, number, number, number] }
const EMPTY_COUNTS: VisibleObjectCounts = { person: 0, car: 0, motorcycle: 0 };

interface PreviewMetadata {
  sequence: number;
  timestamp: number;
  width: number;
  height: number;
}

const HEADER_BYTES = 32;
function previewUrl(cameraId: string): string {
  const base = (import.meta.env.VITE_WS_URL ?? "ws://localhost:5005").replace(/\/$/, "");
  return `${base}/ws/cameras/${encodeURIComponent(cameraId)}/live`;
}

export function useLivePreview(cameraId: string | undefined, enabled: boolean): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: LivePreviewStatus;
  fps: number;
  lastFrameAt: Date | null;
  visibleCounts: VisibleObjectCounts;
  visibleTracks: VisibleTrack[];
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<LivePreviewStatus>(enabled ? "connecting" : "offline");
  const [fps, setFps] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<Date | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<VisibleObjectCounts>(EMPTY_COUNTS);
  const [visibleTracks, setVisibleTracks] = useState<VisibleTrack[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setFps(0);
    setLastFrameAt(null);
    setVisibleCounts(EMPTY_COUNTS);
    setVisibleTracks([]);
    if (!cameraId || !enabled) {
      setStatus("offline");
      return;
    }

    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let staleTimer: number | undefined;
    let stopped = false;
    let reconnects = 0;
    let latestSequence = -1;
    let lastReceived = 0;
    let staleMs = 10_000;
    let framesThisWindow = 0;
    let fpsWindowStarted = performance.now();

    const draw = async (packet: ArrayBuffer) => {
      if (packet.byteLength < HEADER_BYTES) return;
      const view = new DataView(packet);
      const magic = String.fromCharCode(...new Uint8Array(packet, 0, 4));
      const version = view.getUint8(4);
      const headerBytes = view.getUint16(6);
      const sequence = Number(view.getBigUint64(8));
      const timestamp = Number(view.getBigUint64(16));
      const width = view.getUint16(24);
      const height = view.getUint16(26);
      const jpegBytes = view.getUint32(28);
      if (magic !== "CCTV" || version !== 1 || headerBytes !== HEADER_BYTES || jpegBytes !== packet.byteLength - HEADER_BYTES || sequence <= latestSequence) return;
      const metadata: PreviewMetadata = { sequence, timestamp, width, height };
      const bitmap = await createImageBitmap(new Blob([packet.slice(HEADER_BYTES)], { type: "image/jpeg" }));
      if (stopped || metadata.sequence <= latestSequence) {
        bitmap.close();
        return;
      }
      latestSequence = metadata.sequence;
      const target = canvasRef.current;
      const context = target?.getContext("2d", { alpha: false });
      if (target && context) {
        if (target.width !== metadata.width || target.height !== metadata.height) {
          target.width = metadata.width;
          target.height = metadata.height;
        }
        context.drawImage(bitmap, 0, 0, metadata.width, metadata.height);
      }
      bitmap.close();
      lastReceived = Date.now();
      framesThisWindow += 1;
      const now = performance.now();
      if (now - fpsWindowStarted >= 1_000) {
        setFps(framesThisWindow * 1_000 / (now - fpsWindowStarted));
        framesThisWindow = 0;
        fpsWindowStarted = now;
        setLastFrameAt(new Date(metadata.timestamp));
      }
      setStatus((current) => current === "live" ? current : "live");
    };

    const connect = () => {
      if (stopped) return;
      setStatus(reconnects ? "reconnecting" : "connecting");
      socket = new WebSocket(previewUrl(cameraId));
      socket.binaryType = "arraybuffer";
      socket.onopen = () => { reconnects = 0; };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          void draw(event.data).catch(() => setStatus("error"));
          return;
        }
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; staleSeconds?: number; cameraId?: string; counts?: VisibleObjectCounts; tracks?: VisibleTrack[] };
          if (typeof message.staleSeconds === "number") staleMs = message.staleSeconds * 1_000;
          if (message.type === "preview.objects" && message.cameraId === cameraId && message.counts) {
            const next = message.counts;
            setVisibleCounts((current) => current.person === next.person && current.car === next.car && current.motorcycle === next.motorcycle ? current : next);
            setVisibleTracks(message.tracks ?? []);
          }
          if (message.type === "camera.preview.stopped") {
            setStatus("offline");
            setVisibleCounts(EMPTY_COUNTS);
            setVisibleTracks([]);
          }
        } catch { /* Ignore unknown control messages. */ }
      };
      socket.onerror = () => setStatus("error");
      socket.onclose = () => {
        if (stopped) return;
        reconnects += 1;
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** (reconnects - 1)));
      };
    };

    staleTimer = window.setInterval(() => {
      if (lastReceived && Date.now() - lastReceived > staleMs) {
        setStatus("offline");
        setVisibleCounts(EMPTY_COUNTS);
        setVisibleTracks([]);
      }
    }, 1_000);
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (staleTimer) window.clearInterval(staleTimer);
      socket?.close();
      const current = canvasRef.current;
      current?.getContext("2d")?.clearRect(0, 0, current.width, current.height);
    };
  }, [cameraId, enabled]);

  return { canvasRef, status, fps, lastFrameAt, visibleCounts, visibleTracks };
}

