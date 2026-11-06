import { useQuery } from "@tanstack/react-query";
import { Bike, Car, ScanLine, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardTitle } from "../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { StatusBadge } from "../components/ui/status-badge";
import { fetchCameras } from "../features/cameras/api";
import { fetchDetections } from "../features/detections/api";
import { fetchSummary, fetchTimeline } from "../features/statistics/api";
import { formatDateTime, labelize } from "../lib/format";

export function OverviewPage() {
  const summary = useQuery({ queryKey: ["statistics", "summary", "today"], queryFn: () => fetchSummary({ range: "today" }) });
  const timeline = useQuery({ queryKey: ["statistics", "timeline", "today"], queryFn: () => fetchTimeline({ range: "today" }) });
  const detections = useQuery({ queryKey: ["detections", "recent"], queryFn: () => fetchDetections({ page: 1, limit: 6 }) });
  const cameras = useQuery({ queryKey: ["cameras", "overview"], queryFn: () => fetchCameras({ page: 1, limit: 100 }) });
  if (summary.isLoading) return <LoadingState label="Loading overview" />;
  if (summary.isError || !summary.data) return <ErrorState />;
  const count = (type: string) => summary.data.buckets.filter((item) => item.objectType === type).reduce((total, item) => total + item.count, 0);
  const cards = [
    { label: "Total Person", value: count("person"), icon: Users, color: "bg-blue-50 text-blue-600" },
    { label: "Total Car", value: count("car"), icon: Car, color: "bg-violet-50 text-violet-600" },
    { label: "Total Motorcycle", value: count("motorcycle"), icon: Bike, color: "bg-amber-50 text-amber-600" },
    { label: "Counting Events", value: summary.data.totalEvents, icon: ScanLine, color: "bg-emerald-50 text-emerald-600" },
  ];
  const chart = Object.values((timeline.data?.items ?? []).reduce<Record<string, { time: string; count: number }>>((acc, item) => {
    const key = item.periodStart; acc[key] ??= { time: new Date(key).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), count: 0 }; acc[key].count += item.count; return acc;
  }, {}));
  const inCount = summary.data.buckets.filter((x) => x.direction === "in").reduce((t, x) => t + x.count, 0);
  const outCount = summary.data.totalEvents - inCount;
  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold tracking-tight">Today at a glance</h2><p className="mt-1 text-sm text-slate-500">Counting activity for the Jakarta reporting day.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, color }) => <Card key={label}><div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold">{value.toLocaleString()}</p></div><div className={`grid size-11 place-items-center rounded-xl ${color}`}><Icon className="size-5" /></div></div></Card>)}</div>
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardTitle>Hourly counting timeline</CardTitle>{chart.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><defs><linearGradient id="countFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.3}/><stop offset="100%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Area type="monotone" dataKey="count" stroke="#2563eb" fill="url(#countFill)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div> : <EmptyState title="No counts today" detail="The chart will populate after a protected CV event is accepted." />}</Card>
      <Card><CardTitle>Direction and cameras</CardTitle><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-medium text-emerald-700">IN</p><p className="mt-1 text-2xl font-bold text-emerald-900">{inCount}</p></div><div className="rounded-xl bg-orange-50 p-4"><p className="text-xs font-medium text-orange-700">OUT</p><p className="mt-1 text-2xl font-bold text-orange-900">{outCount}</p></div></div><div className="mt-5 space-y-2 border-t border-slate-100 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Camera status</p>{cameras.data?.items.length ? cameras.data.items.slice(0, 5).map((camera) => <div className="flex items-center justify-between text-sm" key={camera.cameraId}><span className="truncate">{camera.name}</span><StatusBadge status={camera.status} /></div>) : <p className="text-sm text-slate-500">No cameras configured.</p>}</div></Card>
    </div>
    <Card><CardTitle>Recent detection events</CardTitle>{detections.isLoading ? <LoadingState /> : detections.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="pb-3">Time</th><th className="pb-3">Camera</th><th className="pb-3">Object</th><th className="pb-3">Direction</th></tr></thead><tbody className="divide-y divide-slate-100">{detections.data.items.map((event) => <tr key={event.eventId}><td className="py-3 pr-4 text-slate-500">{formatDateTime(event.timestamp)}</td><td className="py-3 pr-4 font-medium">{event.cameraId}</td><td className="py-3 pr-4">{labelize(event.objectType)}</td><td className="py-3 uppercase">{event.direction}</td></tr>)}</tbody></table></div> : <EmptyState title="No detection events" detail="Events received from the future CV worker will appear here." />}</Card>
  </div>;
}
