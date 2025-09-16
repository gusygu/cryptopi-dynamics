"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

const items: Item[] = [
  { href: "/dynamics",          label: "Dashboard" },
  { href: "/",          label: "Matrices"  },
  { href: "/str-aux",    label: "Str-aux"   },
  { href: "/settings",  label: "Settings"  },
  { href: "/intro",     label: "Intro"     }, // README-ish
];

export default function NavBar({ className = "" }: { className?: string }) {
  const pathname = usePathname() || "/";
  return (
    <nav className={`w-full rounded-xl bg-slate-900/40 border border-slate-700/40 px-3 py-2 ${className}`}>
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          const cls = active
            ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/30"
            : "bg-slate-800/30 text-slate-200 border-slate-600/30 hover:bg-slate-700/40";
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`px-3 py-1.5 text-sm rounded-md border transition ${cls}`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
