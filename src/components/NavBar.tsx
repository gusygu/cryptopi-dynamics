"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dynamics", label: "Dynamics" },
  { href: "/str-aux", label: "STR-AUX" },
  { href: "/matrices", label: "Matrices" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar() {
  const pathname = (usePathname() || "").replace(/\/+$/, "") || "/";
  return (
    <nav className="sticky top-0 z-40 backdrop-blur bg-slate-900/70 border-b border-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2">
        <div className="text-slate-200 font-semibold tracking-wide">CryptoPi</div>
        <div className="ml-auto flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={[
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  active
                    ? "bg-slate-800 text-slate-50 border-slate-700"
                    : "text-slate-300 border-transparent hover:border-slate-700 hover:bg-slate-800/50",
                ].join(" ")}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
