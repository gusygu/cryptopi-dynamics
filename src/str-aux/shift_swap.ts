// src/str-aux/shift_swap.ts
type Hms = string; // "hh:mm:ss"

export type ShiftState = {
  count: number;            // number of shifts so far
  active: boolean;          // shift_stamp (boolean)
  lastHms?: Hms;            // last shift hh:mm:ss
  // internal trackers:
  pendingSince?: number;    // ms timestamp when |gfm_delta_pct| first exceeded epsilon
};

export type SwapState = {
  count: number;            // number of swaps so far
  lastHms?: Hms;            // last swap hh:mm:ss
  lastSign?: "pos" | "neg" | "zero";
};

export type SessionState = {
  shift: ShiftState;
  swap:  SwapState;
};

const SESSIONS = new Map<string, SessionState>(); // keyed by sessionStamp

function pad2(n: number) { return n.toString().padStart(2, "0"); }
function toHms(ts: number): Hms {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function getSession(sessionStamp: string): SessionState {
  const prev = SESSIONS.get(sessionStamp);
  if (prev) return prev;
  const fresh: SessionState = {
    shift: { count: 0, active: false },
    swap:  { count: 0, lastSign: undefined },
  };
  SESSIONS.set(sessionStamp, fresh);
  return fresh;
}

/**
 * Update shift logic.
 * A "shift" is registered when |gfm_delta_pct| >= epsilon continuously
 * for at least secondaryMs milliseconds.
 */
export function updateShift(
  sessionStamp: string,
  gfm_delta_pct: number,
  epsilon: number,
  secondaryMs: number,
  nowTs = Date.now(),
) {
  const st = getSession(sessionStamp);
  const s = st.shift;
  const mag = Math.abs(gfm_delta_pct);

  if (mag >= epsilon) {
    if (s.pendingSince == null) {
      s.pendingSince = nowTs;
    }
    // if sustained for one full secondary loop, register a shift
    if (!s.active && nowTs - s.pendingSince >= secondaryMs) {
      s.count += 1;
      s.active = true;
      s.lastHms = toHms(nowTs);
      s.pendingSince = undefined; // consumed
    }
  } else {
    // below threshold: reset pending window; if we were active, drop active flag
    s.pendingSince = undefined;
    s.active = false;
  }
  return { shift_stamp: s.active, shift_n: s.count, shift_hms: s.lastHms ?? null };
}

/**
 * Update swap logic.
 * A "swap" occurs when id_pct crosses zero between ticks.
 * We report sign as "ascending" (neg -> pos) or "descending" (pos -> neg).
 */
export function updateSwap(
  sessionStamp: string,
  id_pct: number,
  nowTs = Date.now(),
) {
  const st = getSession(sessionStamp);
  const s = st.swap;

  const sign: "pos" | "neg" | "zero" =
    id_pct > 0 ? "pos" : id_pct < 0 ? "neg" : "zero";

  let swapSign: "ascending" | "descending" | null = null;

  if (s.lastSign && s.lastSign !== "zero" && sign !== "zero" && s.lastSign !== sign) {
    // real crossing
    s.count += 1;
    swapSign = s.lastSign === "neg" && sign === "pos" ? "ascending" : "descending";
    s.lastHms = toHms(nowTs);
  }

  s.lastSign = sign;

  return { swap_n: s.count, swap_sign: swapSign, swap_hms: s.lastHms ?? null };
}

/** Convenience bundle: compute both and return a compact payload for the route */
export function computeShiftSwap(
  sessionStamp: string,
  params: { gfm_delta_pct: number; id_pct: number; epsilon: number; secondaryMs: number; nowTs?: number }
) {
  const a = updateShift(sessionStamp, params.gfm_delta_pct, params.epsilon, params.secondaryMs, params.nowTs);
  const b = updateSwap(sessionStamp, params.id_pct, params.nowTs);
  return { ...a, ...b };
}
