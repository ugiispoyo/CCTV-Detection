import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardTitle } from "../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { fetchCameras } from "../features/cameras/api";
import { fetchCameraSummary, fetchSummary, fetchTimeline } from "../features/statistics/api";
import { labelize } from "../lib/format";

const colors = ["#2563eb", "#7c3aed", "#f59e0b"];

export function StatisticsPage() {
  const [cameraId, setCameraId] = useState("");
  const [range, setRange] = useState("7d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const rangeParams: Record<string, unknown> = range === "custom" && startDate && endDate ? { range, startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString() } : { range };
  const summary = useQuery({ queryKey: ["statistics", "summary", cameraId, rangeParams], queryFn: () => cameraId ? fetchCameraSummary(cameraId, rangeParams) : fetchSummary(rangeParams), enabled: range !== "custom" || Boolean(startDate && endDate) });
  const timeline = useQuery({ queryKey: ["statistics", "timeline", cameraId, rangeParams], queryFn: () => fetchTimeline({ ...rangeParams, ...(cameraId ? { cameraId } : {}) }), enabled: range !== "custom" || Boolean(startDate && endDate) });
  const cameras = useQuery({ queryKey: ["cameras", "statistics-filter"], queryFn: () => fetchCameras({ page: 1, limit: 100 }) });
  const categoryData = ["person", "car", "motorcycle"].map((type) => ({ name: labelize(type), value: summary.data?.buckets.filter((b) => b.objectType === type).reduce((total, b) => total + b.count, 0) ?? 0 }));
  const directionData = ["in", "out"].map((direction) => ({ direction: direction.toUpperCase(), count: summary.data?.buckets.filter((b) => b.direction === direction).reduce((total, b) => total + b.count, 0) ?? 0 }));
  const timelineData = Object.values((timeline.data?.items ?? []).reduce<Record<string, { time: string; person: number; car: number; motorcycle: number }>>((acc, item) => {
    const key = item.periodStart; acc[key] ??= { time: new Date(key).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }), person: 0, car: 0, motorcycle: 0 }; acc[key][item.objectType] += item.count; return acc;
  }, {}));
  return <div className="space-y-6"><div><h2 className="text-2xl font-bold">Counting statistics</h2><p className="mt-1 text-sm text-slate-500">Hourly summaries grouped by object and direction.</p></div>
    <Card><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="">All cameras</option>{cameras.data?.items.map((camera) => <option key={camera.cameraId} value={camera.cameraId}>{camera.name}</option>)}</select><select value={range} onChange={(e) => setRange(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option></select>{range === "custom" && <><input aria-label="Start date" type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><input aria-label="End date" type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /></>}</div></Card>
    {summary.isLoading ? <LoadingState /> : summary.isError ? <ErrorState message={summary.error.message} /> : !summary.data ? <EmptyState title="Choose a complete range" detail="Both dates are required for a custom report." /> : <>
      <div className="grid gap-4 sm:grid-cols-3"><Card><p className="text-sm text-slate-500">Total events</p><p className="mt-2 text-3xl font-bold">{summary.data.totalEvents.toLocaleString()}</p></Card><Card><div className="flex items-center gap-2 text-sm text-slate-500"><ArrowDownToLine className="size-4 text-emerald-600" />Total in</div><p className="mt-2 text-3xl font-bold">{directionData[0]?.count.toLocaleString()}</p></Card><Card><div className="flex items-center gap-2 text-sm text-slate-500"><ArrowUpFromLine className="size-4 text-orange-600" />Total out</div><p className="mt-2 text-3xl font-bold">{directionData[1]?.count.toLocaleString()}</p></Card></div>
      <div className="grid gap-6 lg:grid-cols-2"><Card><CardTitle>Object category breakdown</CardTitle>{summary.data.totalEvents ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>{categoryData.map((item, index) => <Cell key={item.name} fill={colors[index]!} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <EmptyState title="No category data" detail="No events fall inside this reporting range." />}</Card><Card><CardTitle>In / out comparison</CardTitle>{summary.data.totalEvents ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={directionData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="direction" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#2563eb" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="No direction data" detail="No events fall inside this reporting range." />}</Card></div>
      <Card><CardTitle>Hourly timeline</CardTitle>{timelineData.length ? <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={timelineData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" minTickGap={30} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="person" stackId="objects" fill={colors[0]} /><Bar dataKey="car" stackId="objects" fill={colors[1]} /><Bar dataKey="motorcycle" stackId="objects" fill={colors[2]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="No timeline data" detail="Hourly bars appear after events are counted." />}</Card>
    </>}
  </div>;
}
