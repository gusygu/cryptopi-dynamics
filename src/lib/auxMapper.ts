// src/lib/auxMapper.ts
import type { AuxCardsProps, AuxMea, AuxStr, AuxCinRow } from "@/lab/legacy/AuxCards";

export function toAuxCardsProps(vm: any, pairKey?: string, isPairAvailable?: boolean): AuxCardsProps {
  const mea: AuxMea = {
    value: vm?.panels?.mea?.value ?? vm?.matrix?.meaValue,
    tier:  vm?.panels?.mea?.tier  ?? vm?.matrix?.meaTier,
  };

  const str: AuxStr = {
    gfmDeltaPct: vm?.panels?.str?.gfmDeltaPct ?? vm?.str?.gfmDeltaPct,
    vTendency:   vm?.panels?.str?.vTendency   ?? vm?.str?.vTendency,
    shift:       vm?.panels?.str?.shift       ?? vm?.str?.shift,
    swap:        vm?.panels?.str?.swap        ?? vm?.str?.swap,
  };

  const cinRows: AuxCinRow[] =
    (vm?.panels?.cin?.rows ??
     vm?.cin?.rows ??
     []).map((r: any) => ({
       coin: String(r?.coin ?? r?.sym ?? "—"),
       impSes: Number(r?.impSes),
       lugSes: Number(r?.lugSes),
       impCyc: Number(r?.impCyc),
       lugCyc: Number(r?.lugCyc),
     }));

  return { pairKey, isPairAvailable, mea, str, cin: cinRows };
}
