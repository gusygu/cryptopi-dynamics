// Server landing page
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "CryptoPi \u0007 Home" };

export default function Page() {
  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 p-8">
      <h1 className="text-2xl font-semibold">CryptoPi Dynamics</h1>
      <p className="mt-2 text-slate-400">Welcome. Explore live matrices and auxiliaries.</p>
      <div className="mt-6 inline-flex gap-3">
        <Link href="/dynamics" className="rounded-lg border border-slate-700/60 px-4 py-2 hover:bg-slate-800/60">Open Dynamics</Link>
        <Link href="/matrices" className="rounded-lg border border-slate-700/60 px-4 py-2 hover:bg-slate-800/60">Matrices</Link>
        <Link href="/settings" className="rounded-lg border border-slate-700/60 px-4 py-2 hover:bg-slate-800/60">Settings</Link>
      </div>
    </main>
  );
}

