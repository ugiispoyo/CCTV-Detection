import { Link } from "react-router-dom";

export function NotFoundPage() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><p className="text-sm font-semibold text-blue-600">404</p><h2 className="mt-2 text-3xl font-bold">Page not found</h2><p className="mt-2 text-slate-500">The monitoring page you requested does not exist.</p><Link className="mt-6 inline-block rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white" to="/">Return to overview</Link></div></div>;
}
