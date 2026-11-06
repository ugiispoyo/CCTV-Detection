import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Camera, CircleDot, LayoutDashboard, Menu, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { getData } from "../../lib/api";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/live", label: "Live Monitoring", icon: Video },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/detections", label: "Detections", icon: CircleDot },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const location = useLocation();
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => setOpen(false), [location.pathname]);
  const health = useQuery({ queryKey: ["health"], queryFn: () => getData<{ status: string }>("/health"), refetchInterval: 30_000, retry: 1 });
  const title = navigation.find((item) => item.to === location.pathname)?.label ?? "CCTV AI Monitoring";

  return <div className="min-h-screen bg-slate-50">
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-800 bg-slate-950 text-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-20 items-center justify-between border-b border-slate-800 px-5">
        <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-blue-600"><Activity className="size-5" /></div><div><p className="font-semibold">CCTV AI</p><p className="text-xs text-slate-400">Monitoring</p></div></div>
        <button className="lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}><X className="size-5" /></button>
      </div>
      <nav className="space-y-1 p-4" aria-label="Main navigation">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"}`}><Icon className="size-5" />{label}</NavLink>)}</nav>
      <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">REST data is authoritative. Live updates are notifications only.</div>
    </aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex items-center gap-3"><button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu className="size-5" /></button><div><h1 className="text-lg font-semibold text-slate-950">{title}</h1><p className="hidden text-xs text-slate-500 sm:block">{now.toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" })} WIB</p></div></div>
        <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${health.isSuccess ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}><span className={`size-2 rounded-full ${health.isSuccess ? "bg-emerald-500" : "bg-red-500"}`} />API {health.isSuccess ? "connected" : "unavailable"}</div>
      </header>
      <main className="p-4 sm:p-6 lg:p-8"><Outlet /></main>
    </div>
  </div>;
}
