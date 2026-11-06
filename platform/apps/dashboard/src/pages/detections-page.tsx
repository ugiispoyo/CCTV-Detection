import { useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";
import { useState } from "react";
import { Card, CardTitle } from "../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { fetchCameras } from "../features/cameras/api";
import { fetchDetections } from "../features/detections/api";
import { confidencePercent, formatDateTime, labelize } from "../lib/format";

export function DetectionsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ cameraId: "", objectType: "", direction: "", startDate: "", endDate: "" });
  const params = { page, limit: 20, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, key.endsWith("Date") ? new Date(value).toISOString() : value])) };
  const detections = useQuery({ queryKey: ["detections", params], queryFn: () => fetchDetections(params) });
  const cameras = useQuery({ queryKey: ["cameras", "filter"], queryFn: () => fetchCameras({ page: 1, limit: 100 }) });
  const setFilter = (name: string, value: string) => { setPage(1); setFilters((current) => ({ ...current, [name]: value })); };
  return <div className="space-y-6"><div><h2 className="text-2xl font-bold">Detection events</h2><p className="mt-1 text-sm text-slate-500">Auditable line-crossing records received from the CV service.</p></div><Card><CardTitle><span className="flex items-center gap-2"><Filter className="size-4" />Filters</span></CardTitle><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <select aria-label="Camera" value={filters.cameraId} onChange={(e) => setFilter("cameraId", e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="">All cameras</option>{cameras.data?.items.map((camera) => <option value={camera.cameraId} key={camera.cameraId}>{camera.name}</option>)}</select>
    <select aria-label="Object type" value={filters.objectType} onChange={(e) => setFilter("objectType", e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="">All objects</option><option value="person">Person</option><option value="car">Car</option><option value="motorcycle">Motorcycle</option></select>
    <select aria-label="Direction" value={filters.direction} onChange={(e) => setFilter("direction", e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"><option value="">Both directions</option><option value="in">In</option><option value="out">Out</option></select>
    <input aria-label="Start date" type="datetime-local" value={filters.startDate} onChange={(e) => setFilter("startDate", e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
    <input aria-label="End date" type="datetime-local" value={filters.endDate} onChange={(e) => setFilter("endDate", e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
  </div></Card>
  <Card>{detections.isLoading ? <LoadingState /> : detections.isError ? <ErrorState message={detections.error.message} /> : !detections.data?.items.length ? <EmptyState title="No matching events" detail="Adjust the filters or wait for the CV worker to submit a counting event." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase text-slate-400"><tr>{["Timestamp", "Camera", "Object type", "Tracking ID", "Direction", "Confidence"].map((head) => <th className="pb-3 pr-4" key={head}>{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{detections.data.items.map((event) => <tr key={event.eventId}><td className="py-3.5 pr-4 text-slate-500">{formatDateTime(event.timestamp)}</td><td className="py-3.5 pr-4 font-medium">{event.cameraId}</td><td className="py-3.5 pr-4">{labelize(event.objectType)}</td><td className="py-3.5 pr-4 font-mono">{event.trackId}</td><td className="py-3.5 pr-4 uppercase">{event.direction}</td><td className="py-3.5">{confidencePercent(event.confidence)}</td></tr>)}</tbody></table></div>}</Card>
  {detections.data && detections.data.pagination.totalPages > 1 && <div className="flex justify-center gap-3"><button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="py-2 text-sm text-slate-500">{page} / {detections.data.pagination.totalPages}</span><button disabled={page >= detections.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button></div>}
  </div>;
}
