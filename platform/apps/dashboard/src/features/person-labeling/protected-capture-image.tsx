import { useEffect, useRef, useState } from "react";
import { fetchCaptureImage } from "./api";

export function ProtectedCaptureImage({ captureId, alt, kind = "full-body" }: { captureId: string; alt: string; kind?: "full-body" | "head" }) {
  const host = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<string>();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let currentUrl: string | undefined;
    let cancelled = false;
    void fetchCaptureImage(captureId, kind).then((blob) => { if (!cancelled) { currentUrl = URL.createObjectURL(blob); setSource(currentUrl); } }).catch(() => undefined);
    return () => { cancelled = true; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [captureId, kind, visible]);
  return <div ref={host} className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-100 p-1">{source ? <img src={source} alt={alt} loading="lazy" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-xs text-slate-400">Protected image</div>}</div>;
}
