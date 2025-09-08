"use client";
import { heat, formatForDisplay, tsLabel, HeatKind } from "@/lib/format";

type Flags = { frozen: boolean[][]; flip?: (-1 | 0 | 1)[][] } | null;

type Props = {
  title: string;
  coins: string[];
  grid: (number | null)[][];
  flags?: Flags;
  kind: HeatKind; // 'pct' ONLY for pct24h; everything else 'abs'
  ts?: number | null;
  flipOverlay?: boolean; // <-- only set true for pct_drv
};

export default function Matrix({ title, coins, grid, flags, kind, ts, flipOverlay = false }: Props) {
  const tsText = tsLabel(ts ?? null);

  return (
    <div className="rounded-2xl bg-slate-800/60 p-3 shadow-sm border border-slate-700/30">
      <div className="flex items-center justify-between mb-2">
        <div className="text-slate-100 text-sm">{title}</div>
        <div className="text-[10px] text-slate-400">ts: {tsText}</div>
      </div>
      <div className="overflow-auto">
        <table className="text-xs text-slate-200">
          <thead>
            <tr>
              <th className="px-2 py-1"></th>
              {coins.map((c) => (
                <th key={c} className="px-2 py-1">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coins.map((r, i) => (
              <tr key={r}>
                <th className="px-2 py-1 text-slate-300">{r}</th>
                {coins.map((c, j) => {
                  const v = grid?.[i]?.[j] ?? null;
                  const isFrozen = !!flags?.frozen?.[i]?.[j];
                  const baseStyle = heat(v, { kind, frozen: isFrozen });
                  const label = formatForDisplay(v, kind);

                  // Flip ring ONLY if flipOverlay==true (we'll pass this for pct_drv) and flags.flip exists
                  let boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.04)"; // default subtle inner border
                  if (flipOverlay && flags?.flip) {
                    const f = flags.flip[i]?.[j] ?? 0;
                    if (f === -1) {
                      // +→−  (orange ring)
                      boxShadow = "inset 0 0 0 2px rgba(245,158,11,0.8)";
                    } else if (f === 1) {
                      // −→+  (blue ring)
                      boxShadow = "inset 0 0 0 2px rgba(59,130,246,0.8)";
                    }
                  }

                  const tipParts = [`${r}/${c} = ${label}`];
                  if (isFrozen) tipParts.push("(frozen)");
                  if (flipOverlay && flags?.flip) {
                    const f = flags.flip[i]?.[j] ?? 0;
                    if (f === -1) tipParts.push("id_pct +→−");
                    if (f === 1) tipParts.push("id_pct −→+");
                  }
                  const titleTip = tipParts.join(" • ");

                  return (
                    <td key={c} className="p-1 align-middle">
                      <div
                        className="px-2 py-1 font-mono text-right rounded-md transition-colors duration-200"
                        title={titleTip}
                        style={{ ...baseStyle, boxShadow }}
                      >
                        {label}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
