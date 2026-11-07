import type { Camera } from "@cctv-ai/shared";
import { useQuery } from "@tanstack/react-query";
import { Bike, Car, Expand, LogIn, LogOut, Play, Square, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardTitle } from "../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { StatusBadge } from "../components/ui/status-badge";
import { fetchCameras } from "../features/cameras/api";
import { fetchDetections } from "../features/detections/api";
import { useLivePreview } from "../features/live-monitoring/hooks/use-live-preview";
import { fetchActiveIdentities } from "../features/person-labeling/api";
import { fetchSummary } from "../features/statistics/api";
import { formatDateTime, labelize } from "../lib/format";

const statusLabel = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", offline: "Preview unavailable", error: "Connection error" } as const;

function groupName(camera: Camera): string {
  if (!camera.physicalCameraId) return camera.name;
  return camera.name.replace(/\s*[-–]\s*(lens|main stream).*$/i, "") || camera.physicalCameraId;
}

function LiveFeedCard({ camera, enabled }: { camera: Camera; enabled: boolean }) {
  const preview = useLivePreview(camera.cameraId, enabled);
  const identities = useQuery({ queryKey: ["active-identities", camera.cameraId], queryFn: () => fetchActiveIdentities(camera.cameraId), enabled, refetchInterval: 5_000, retry: false });
  const container = useRef<HTMLDivElement>(null);
  const summary = useQuery({ queryKey: ["statistics", "live", camera.cameraId], queryFn: () => fetchSummary({ range: "today", cameraId: camera.cameraId }), refetchInterval: 15_000 });
  const count = (type: string) => summary.data?.buckets.filter((bucket) => bucket.objectType === type).reduce((total, bucket) => total + bucket.count, 0) ?? 0;
  const incoming = summary.data?.buckets.filter((bucket) => bucket.direction === "in").reduce((total, bucket) => total + bucket.count, 0) ?? 0;
  const outgoing = summary.data?.buckets.filter((bucket) => bucket.direction === "out").reduce((total, bucket) => total + bucket.count, 0) ?? 0;
  const visible = [["Person", preview.visibleCounts.person, Users, "text-purple-600 bg-purple-50"], ["Car", preview.visibleCounts.car, Car, "text-emerald-600 bg-emerald-50"], ["Motorcycle", preview.visibleCounts.motorcycle, Bike, "text-blue-600 bg-blue-50"]] as const;
  const stats = [["Crossed Person", count("person"), Users, "text-purple-600"], ["Crossed Car", count("car"), Car, "text-emerald-600"], ["Crossed Motorcycle", count("motorcycle"), Bike, "text-blue-600"], ["IN", incoming, LogIn, "text-cyan-600"], ["OUT", outgoing, LogOut, "text-orange-600"]] as const;
  return <Card className="overflow-hidden p-0">
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="min-w-0"><p className="truncate font-semibold">{camera.lensName ?? camera.name}</p><p className="truncate text-xs text-slate-500">{camera.name} · {camera.cameraId}</p></div><div className="flex shrink-0 items-center gap-2"><StatusBadge status={camera.status} /><span className={`rounded-full px-2 py-1 text-xs font-medium ${preview.status === "live" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel[preview.status]}</span></div></div>
    <div ref={container} className="relative grid aspect-video place-items-center bg-slate-950"><canvas ref={preview.canvasRef} className={`h-full w-full object-contain ${preview.status === "live" ? "opacity-100" : "opacity-40"}`} />{identities.data?.map((identity) => { const track = preview.visibleTracks.find((item) => item.objectType === "person" && item.trackId === identity.trackId); return track ? <div key={`${identity.sessionId}-${identity.trackId}`} className="pointer-events-none absolute rounded bg-emerald-600/95 px-2 py-1 text-xs font-semibold text-white shadow" style={{ left: `${track.bbox[0] * 100}%`, top: `${Math.max(track.bbox[1] * 100 - 4, 0)}%` }}>{identity.fullName} #{identity.trackId} — Verified</div> : null; })}{preview.status !== "live" && <div className="absolute text-center text-sm text-slate-300"><p className="font-medium">{camera.status === "offline" ? "Camera offline" : statusLabel[preview.status]}</p><p className="mt-1 text-xs text-slate-500">Waiting for fresh annotated frames</p></div>}<button title="Fullscreen" className="absolute right-3 top-3 rounded-lg bg-slate-950/70 p-2 text-white" onClick={() => void container.current?.requestFullscreen()}><Expand className="size-4" /></button></div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs text-slate-500"><span>Preview <strong>{preview.fps.toFixed(1)} FPS</strong></span><span>Last frame <strong>{preview.lastFrameAt ? formatDateTime(preview.lastFrameAt.toISOString()) : "—"}</strong></span><span>RTSP <strong>{camera.status}</strong></span></div>
    <div className="border-b border-slate-100 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Visible now</p><div className="grid grid-cols-3 gap-2">{visible.map(([label, value, Icon, tone]) => <div className={`flex items-center justify-between rounded-lg p-2 ${tone}`} key={label}><div className="flex items-center gap-2"><Icon className="size-4" /><span className="text-xs font-medium">{label}</span></div><strong>{value}</strong></div>)}</div></div>
    <div className="grid grid-cols-5 gap-2 p-3">{stats.map(([label, value, Icon, color]) => <div className="rounded-lg bg-slate-50 p-2 text-center" key={label}><Icon className={`mx-auto size-4 ${color}`} /><p className="mt-1 font-bold">{value}</p><p className="text-[10px] text-slate-500">{label}</p></div>)}</div>
  </Card>;
}

export function LiveMonitoringPage() {
  const camerasQuery = useQuery({ queryKey: ["cameras", "live"], queryFn: () => fetchCameras({ page: 1, limit: 100, active: "true" }), refetchInterval: 15_000 });
  const [mode, setMode] = useState<"single" | "grid">("grid");
  const [cameraId, setCameraId] = useState<string>();
  const [groupId, setGroupId] = useState<string>();
  const [enabled, setEnabled] = useState(true);
  const cameras = camerasQuery.data?.items ?? [];
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; cameras: Camera[] }>();
    for (const camera of cameras) {
      const key = camera.physicalCameraId ?? camera.cameraId;
      const group = result.get(key) ?? { name: groupName(camera), cameras: [] };
      group.cameras.push(camera);
      result.set(key, group);
    }
    return result;
  }, [cameras]);
  useEffect(() => {
    if (!cameraId && cameras[0]) setCameraId(cameras[0].cameraId);
    if (cameraId && !cameras.some((camera) => camera.cameraId === cameraId)) setCameraId(cameras[0]?.cameraId);
    const firstGroup = groups.keys().next().value as string | undefined;
    if (!groupId && firstGroup) setGroupId(firstGroup);
    if (groupId && !groups.has(groupId)) setGroupId(firstGroup);
  }, [cameraId, cameras, groupId, groups]);
  const selected = cameras.find((camera) => camera.cameraId === cameraId);
  const gridCameras = groupId ? groups.get(groupId)?.cameras ?? [] : [];
  const detections = useQuery({ queryKey: ["detections", "live", cameraId], queryFn: () => fetchDetections({ page: 1, limit: 8, cameraId }), enabled: mode === "single" && Boolean(cameraId), refetchInterval: 10_000 });

  if (camerasQuery.isLoading) return <LoadingState label="Loading active cameras" />;
  if (camerasQuery.isError) return <ErrorState />;
  if (!cameras.length) return <EmptyState title="No active cameras" detail="Register and activate one logical camera for each verified lens." />;

  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold tracking-tight">Live Monitoring</h2><p className="mt-1 text-sm text-slate-500">Monitor logical camera lenses independently or side by side.</p></div>
    <Card><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div className="flex flex-col gap-3 sm:flex-row"><div className="flex rounded-xl bg-slate-100 p-1"><button className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "single" ? "bg-white shadow-sm" : "text-slate-500"}`} onClick={() => setMode("single")}>Single View</button><button className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "grid" ? "bg-white shadow-sm" : "text-slate-500"}`} onClick={() => setMode("grid")}>Grid View</button></div>{mode === "single" ? <label className="text-sm font-medium text-slate-700">Logical camera<select className="mt-1 block min-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2" value={cameraId ?? ""} onChange={(event) => setCameraId(event.target.value)}>{Array.from(groups.entries()).map(([key, group]) => <optgroup label={group.name} key={key}>{group.cameras.map((camera) => <option value={camera.cameraId} key={camera.cameraId}>{camera.lensName ?? camera.name} — {camera.status}</option>)}</optgroup>)}</select></label> : <label className="text-sm font-medium text-slate-700">Physical camera group<select className="mt-1 block min-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2" value={groupId ?? ""} onChange={(event) => setGroupId(event.target.value)}>{Array.from(groups.entries()).map(([key, group]) => <option value={key} key={key}>{group.name} — {group.cameras.length} feed(s)</option>)}</select></label>}</div><div className="flex gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={enabled} onClick={() => setEnabled(true)}><Play className="size-4" />Start</button><button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={!enabled} onClick={() => setEnabled(false)}><Square className="size-4" />Stop</button></div></div></Card>
    {mode === "single" && selected ? <LiveFeedCard camera={selected} enabled={enabled} /> : <div className="grid gap-6 xl:grid-cols-2">{gridCameras.map((camera) => <LiveFeedCard camera={camera} enabled={enabled} key={camera.cameraId} />)}</div>}
    {mode === "grid" && gridCameras.length > 1 && <p className="text-xs text-slate-500">Totals are crossing events per lens. Overlapping views may count the same real-world object more than once; these are not unique-person totals.</p>}
    {mode === "single" && <Card><CardTitle>Recent counting events</CardTitle>{detections.isLoading ? <LoadingState /> : detections.data?.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Timestamp</th><th className="pb-3">Object</th><th className="pb-3">Camera</th><th className="pb-3">Direction</th><th className="pb-3">Track ID</th></tr></thead><tbody className="divide-y divide-slate-100">{detections.data.items.map((event) => <tr key={event.eventId}><td className="py-3 pr-4 text-slate-500">{formatDateTime(event.timestamp)}</td><td className="py-3 pr-4 font-medium">{labelize(event.objectType)}</td><td className="py-3 pr-4">{event.cameraId}</td><td className="py-3 pr-4 uppercase">{event.direction}</td><td className="py-3">#{event.trackId}</td></tr>)}</tbody></table></div> : <EmptyState title="No counting events" detail="Crossing events from this logical camera will appear here." />}</Card>}
  </div>;
}
