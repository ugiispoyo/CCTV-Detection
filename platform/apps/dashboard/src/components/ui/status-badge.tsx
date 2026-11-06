export function StatusBadge({ status }: { status: string }) {
  const style = status === "online" || status === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : status === "offline" || status === "inactive" ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${style}`}>{status}</span>;
}
