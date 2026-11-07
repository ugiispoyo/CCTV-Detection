import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, LoaderCircle, Trash2, UserPlus, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { createPerson, deleteCapture, fetchCapture, fetchPeople, reviewCapture, verifyCapture, type RegisteredPerson } from "./api";
import { ProtectedCaptureImage } from "./protected-capture-image";

interface CaptureNotice { captureId: string; cameraId: string; capturedAt: string }
const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

export function GlobalPersonCaptureReview() {
  const [notices, setNotices] = useState<CaptureNotice[]>([]);
  const [activeId, setActiveId] = useState<string>();
  useEffect(() => {
    const handler = (event: Event) => {
      const message = (event as CustomEvent<{ data?: CaptureNotice }>).detail;
      const capture = message?.data;
      if (!capture?.captureId) return;
      setNotices((current) => current.some((item) => item.captureId === capture.captureId) ? current : [...current.slice(-4), capture]);
    };
    window.addEventListener("person-capture-created", handler);
    return () => window.removeEventListener("person-capture-created", handler);
  }, []);
  const open = (captureId: string) => { setNotices((items) => items.filter((item) => item.captureId !== captureId)); setActiveId(captureId); };
  return <>
    <div className="fixed right-4 top-24 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
      {notices.map((notice) => <button key={notice.captureId} onClick={() => open(notice.captureId)} className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-white p-4 text-left shadow-xl ring-1 ring-blue-100 transition hover:-translate-y-0.5"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-600 text-white"><BellRing className="size-5" /></span><span className="min-w-0"><span className="block font-semibold text-slate-950">New person detected</span><span className="mt-1 block text-sm text-slate-600">{notice.cameraId} · click to label now</span><span className="mt-1 block text-xs text-slate-400">{new Date(notice.capturedAt).toLocaleString()}</span></span></button>)}
    </div>
    {activeId && <QuickLabelModal captureId={activeId} onClose={() => setActiveId(undefined)} />}
  </>;
}

function QuickLabelModal({ captureId, onClose }: { captureId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const capture = useQuery({ queryKey: ["person-capture", captureId], queryFn: () => fetchCapture(captureId), retry: false });
  const people = useQuery({ queryKey: ["registered-people"], queryFn: () => fetchPeople(), retry: false });
  const [personId, setPersonId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const complete = () => { void queryClient.invalidateQueries({ queryKey: ["person-captures"] }); void queryClient.invalidateQueries({ queryKey: ["registered-people"] }); onClose(); };
  const verify = useMutation({ mutationFn: () => { if (!personId || !confirmed) throw new Error("Explicit confirmation required"); return verifyCapture(captureId, personId); }, onSuccess: complete });
  const dismiss = useMutation({ mutationFn: () => reviewCapture(captureId, "dismiss"), onSuccess: complete });
  const remove = useMutation({ mutationFn: () => deleteCapture(captureId), onSuccess: complete });
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Label detected person">
    <div className="my-8 w-full max-w-4xl rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
      <div className="mb-5 flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-950">Label detected person</h2><p className="mt-1 text-sm text-slate-500">Confirm identity manually. No biometric matching is used.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button></div>
      {capture.isLoading || people.isLoading ? <div className="py-16 text-center text-sm text-slate-500">Loading capture…</div> : capture.isError || people.isError || !capture.data ? <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Capture details could not be loaded.</div> : <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <div><div className="grid grid-cols-2 gap-2"><ProtectedCaptureImage captureId={captureId} alt={`Detected person from ${capture.data.cameraId}`} />{capture.data.hasHeadImage ? <ProtectedCaptureImage captureId={captureId} kind="head" alt={`Head crop from ${capture.data.cameraId}`} /> : <div className="grid aspect-[3/4] place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">Head unavailable</div>}</div><p className="mt-3 text-sm font-medium text-slate-900">{capture.data.cameraId} · Track #{capture.data.trackId}</p><p className="text-xs text-slate-500">{capture.data.direction.toUpperCase()} · {capture.data.lineId} · {(capture.data.confidence * 100).toFixed(0)}% · {new Date(capture.data.capturedAt).toLocaleString()}</p></div>
        <div>{showCreate ? <QuickCreatePerson captureId={captureId} onComplete={complete} onBack={() => setShowCreate(false)} /> : <div className="space-y-4"><label className="block text-sm font-medium text-slate-700">Existing registered person<select className={`${inputClass} mt-2`} value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Select profile</option>{people.data?.items.map((person) => <option key={person.personId} value={person.personId}>{person.fullName} · {person.category}</option>)}</select></label><label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I explicitly confirm the selected profile is this person.</label>{verify.isError && <p className="text-sm text-red-600">Failed to save label. Please try again.</p>}{remove.isError && <p className="text-sm text-red-600">Delete failed. Only pending or dismissed captures can be deleted.</p>}<button disabled={!personId || !confirmed || verify.isPending || remove.isPending} onClick={() => verify.mutate()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{verify.isPending ? <><LoaderCircle className="size-4 animate-spin" />Saving...</> : <><CheckCircle2 className="size-4" />Save Labeling</>}</button><button onClick={() => setShowCreate(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-medium text-blue-700"><UserPlus className="size-4" />Create new profile</button><button disabled={dismiss.isPending || remove.isPending} onClick={() => dismiss.mutate()} className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm text-red-700 disabled:opacity-40">Dismiss this capture</button><button disabled={remove.isPending || dismiss.isPending || verify.isPending} onClick={() => remove.mutate()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{remove.isPending ? <><LoaderCircle className="size-4 animate-spin" />Deleting...</> : <><Trash2 className="size-4" />Delete permanently</>}</button></div>}</div>
      </div>}
    </div>
  </div>;
}

function QuickCreatePerson({ captureId, onComplete, onBack }: { captureId: string; onComplete: () => void; onBack: () => void }) {
  const [form, setForm] = useState({ fullName: "", category: "resident" as RegisteredPerson["category"], block: "", houseNumber: "", notes: "" });
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useMutation({ mutationFn: async () => { if (!confirmed) throw new Error("Confirmation required"); const person = await createPerson({ fullName: form.fullName, category: form.category, consentStatus: "not_recorded", ...(form.block ? { block: form.block } : {}), ...(form.houseNumber ? { houseNumber: form.houseNumber } : {}), ...(form.notes ? { notes: form.notes } : {}) }); return verifyCapture(captureId, person.personId); }, onSuccess: onComplete });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  return <form onSubmit={submit} className="space-y-3"><h3 className="font-semibold text-slate-900">Create and link profile</h3><input required maxLength={200} className={inputClass} placeholder="Full name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /><select className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as RegisteredPerson["category"] })}><option value="resident">Resident</option><option value="guest">Guest</option><option value="staff">Staff</option><option value="other">Other</option></select><div className="grid grid-cols-2 gap-3"><input maxLength={50} className={inputClass} placeholder="Block" value={form.block} onChange={(event) => setForm({ ...form, block: event.target.value })} /><input maxLength={50} className={inputClass} placeholder="House number" value={form.houseNumber} onChange={(event) => setForm({ ...form, houseNumber: event.target.value })} /></div><textarea maxLength={1000} className={inputClass} placeholder="Notes (optional)" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /><label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I explicitly confirm this person's identity.</label>{mutation.isError && <p className="text-sm text-red-600">Failed to save label. Your entries are preserved.</p>}<div className="flex gap-2"><button type="button" onClick={onBack} className="rounded-xl border px-4 py-2 text-sm">Back</button><button disabled={!confirmed || mutation.isPending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{mutation.isPending ? <><LoaderCircle className="size-4 animate-spin" />Saving...</> : "Save Labeling"}</button></div></form>;
}
