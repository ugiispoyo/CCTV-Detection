import { Maximize2 } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { fetchCaptureImage } from "./api";

export interface NormalizedBox {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
}

interface Point { x: number; y: number }

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function boxFromPoints(start: Point, end: Point): NormalizedBox {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return {
    xCenter: (left + right) / 2,
    yCenter: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  };
}

export function BoundingBoxEditor({ captureId, imageKind, className, value, onChange }: {
  captureId: string;
  imageKind: "full-body" | "head";
  className: "person" | "head" | "car" | "motorcycle";
  value: NormalizedBox;
  onChange: (box: NormalizedBox) => void;
}) {
  const [source, setSource] = useState<string>();
  const [loadError, setLoadError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<Point | undefined>(undefined);
  const previous = useRef<NormalizedBox | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSource(undefined);
    setLoadError(false);
    void fetchCaptureImage(captureId, imageKind)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [captureId, imageKind]);

  const pointFor = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!source || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = pointFor(event);
    previous.current = value;
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !start.current) return;
    onChange(boxFromPoints(start.current, pointFor(event)));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !start.current) return;
    const next = boxFromPoints(start.current, pointFor(event));
    if (next.width < 0.01 || next.height < 0.01) onChange(previous.current ?? value);
    else onChange(next);
    start.current = undefined;
    previous.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const left = clamp(value.xCenter - value.width / 2) * 100;
  const top = clamp(value.yCenter - value.height / 2) * 100;
  const width = Math.min(value.width, 1 - left / 100) * 100;
  const height = Math.min(value.height, 1 - top / 100) * 100;

  return <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
      <span>Drag dari satu sudut ke sudut lainnya untuk membingkai objek.</span>
      <button type="button" onClick={() => onChange({ xCenter: 0.5, yCenter: 0.5, width: 1, height: 1 })} className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/20"><Maximize2 className="size-3.5" />Gunakan seluruh gambar</button>
    </div>
    {loadError ? <div className="grid min-h-64 place-items-center rounded-xl bg-slate-900 text-sm text-red-300">Gambar annotation tidak dapat dimuat.</div> : !source ? <div className="grid min-h-64 place-items-center rounded-xl bg-slate-900 text-sm text-slate-400">Memuat gambar terlindungi…</div> : <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-black">
      <img src={source} alt={`${imageKind} crop for ${className} annotation`} draggable={false} className="block max-h-[32rem] max-w-full select-none" />
      <div className="absolute inset-0 touch-none cursor-crosshair select-none" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <div className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_9999px_rgba(2,6,23,0.28)]" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
          <span className="absolute left-0 top-0 -translate-y-full rounded-t bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white">{className}</span>
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-white ring-2 ring-emerald-500" />
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-white ring-2 ring-emerald-500" />
          <span className="absolute -bottom-1 -left-1 size-2 rounded-full bg-white ring-2 ring-emerald-500" />
          <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-white ring-2 ring-emerald-500" />
        </div>
      </div>
    </div>}
  </div>;
}
