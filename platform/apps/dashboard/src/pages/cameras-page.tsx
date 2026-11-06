import type { Camera as CameraType } from "@cctv-ai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MapPin, Pencil, Plus, Power, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Card } from "../components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { StatusBadge } from "../components/ui/status-badge";
import { createCamera, deactivateCamera, fetchCameras, updateCamera } from "../features/cameras/api";

interface FormValues { cameraId: string; name: string; location: string; description: string; physicalCameraId: string; lensName: string }
const blank: FormValues = { cameraId: "", name: "", location: "", description: "", physicalCameraId: "", lensName: "" };

function CameraForm({ camera, onClose }: { camera?: CameraType; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(camera ? { cameraId: camera.cameraId, name: camera.name, location: camera.location ?? "", description: camera.description ?? "", physicalCameraId: camera.physicalCameraId ?? "", lensName: camera.lensName ?? "" } : blank);
  const mutation = useMutation({
    mutationFn: () => camera ? updateCamera(camera.cameraId, { name: values.name, location: values.location || null, description: values.description || null, physicalCameraId: values.physicalCameraId || null, lensName: values.lensName || null }) : createCamera({ cameraId: values.cameraId, name: values.name, ...(values.location ? { location: values.location } : {}), ...(values.description ? { description: values.description } : {}), ...(values.physicalCameraId ? { physicalCameraId: values.physicalCameraId } : {}), ...(values.lensName ? { lensName: values.lensName } : {}) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["cameras"] }); onClose(); },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{camera ? "Edit camera" : "Add camera"}</h2><button type="button" aria-label="Close" onClick={onClose}><X className="size-5" /></button></div><div className="space-y-4">
    <label className="block text-sm font-medium">Camera ID<input required disabled={Boolean(camera)} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={values.cameraId} onChange={(e) => setValues({ ...values, cameraId: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" placeholder="cam-001" /></label>
    <label className="block text-sm font-medium">Name<input required maxLength={200} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" placeholder="Front entrance" /></label>
    <label className="block text-sm font-medium">Location<input maxLength={200} value={values.location} onChange={(e) => setValues({ ...values, location: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" placeholder="Lobby" /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Physical camera group<input maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" value={values.physicalCameraId} onChange={(e) => setValues({ ...values, physicalCameraId: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" placeholder="h9c-001" /></label><label className="block text-sm font-medium">Lens label<input maxLength={80} value={values.lensName} onChange={(e) => setValues({ ...values, lensName: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" placeholder="Lens 2" /></label></div>
    <label className="block text-sm font-medium">Description<textarea maxLength={500} rows={3} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5" /></label>
    {mutation.isError && <p className="text-sm text-red-600">{mutation.error.message}</p>}
  </div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium">Cancel</button><button disabled={mutation.isPending} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{mutation.isPending ? "Saving…" : "Save camera"}</button></div></form></div>;
}

export function CamerasPage() {
  const queryClient = useQueryClient();
  const [formCamera, setFormCamera] = useState<CameraType | "new" | null>(null);
  const [page, setPage] = useState(1);
  const cameras = useQuery({ queryKey: ["cameras", page], queryFn: () => fetchCameras({ page, limit: 12 }) });
  const deactivate = useMutation({ mutationFn: deactivateCamera, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cameras"] }) });
  return <div className="space-y-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold">Camera management</h2><p className="mt-1 text-sm text-slate-500">Configure camera identities without storing stream credentials.</p></div><button onClick={() => setFormCamera("new")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"><Plus className="size-4" />Add camera</button></div>
    {cameras.isLoading ? <LoadingState /> : cameras.isError ? <ErrorState /> : !cameras.data?.items.length ? <EmptyState title="No cameras configured" detail="Add the first camera to prepare it for a future CV worker." /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cameras.data.items.map((camera) => <Card key={camera.cameraId}><div className="flex items-start justify-between"><div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600"><Camera className="size-5" /></div><StatusBadge status={camera.status} /></div><h3 className="mt-4 font-semibold">{camera.name}</h3><p className="mt-1 font-mono text-xs text-slate-500">{camera.cameraId}</p><p className="mt-3 flex min-h-5 items-center gap-2 text-sm text-slate-500"><MapPin className="size-4" />{camera.location || "No location set"}</p><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4"><StatusBadge status={camera.isActive ? "active" : "inactive"} /><div className="flex gap-1"><button title="Edit camera" onClick={() => setFormCamera(camera)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="size-4" /></button>{camera.isActive && <button title="Deactivate camera" disabled={deactivate.isPending} onClick={() => deactivate.mutate(camera.cameraId)} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Power className="size-4" /></button>}</div></div></Card>)}</div>}
    {cameras.data && cameras.data.pagination.totalPages > 1 && <div className="flex items-center justify-center gap-3"><button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-slate-500">Page {page} of {cameras.data.pagination.totalPages}</span><button disabled={page >= cameras.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Next</button></div>}
    {formCamera && (formCamera === "new" ? <CameraForm onClose={() => setFormCamera(null)} /> : <CameraForm camera={formCamera} onClose={() => setFormCamera(null)} />)}
  </div>;
}
