import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading data" }: { label?: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-5 animate-spin" />{label}</div>;
}

export function ErrorState({ message = "This data could not be loaded." }: { message?: string }) {
  return <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"><AlertCircle className="size-5" />{message}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><Inbox className="mb-3 size-8 text-slate-400" /><p className="font-medium text-slate-700">{title}</p><p className="mt-1 max-w-md text-sm text-slate-500">{detail}</p></div>;
}
