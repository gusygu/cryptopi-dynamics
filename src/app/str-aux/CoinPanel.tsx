'use client';

import * as React from 'react';
import StreamsTable from '@/app/str-aux/StreamTable';

function pretty(n: number | undefined | null, digits = 6) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const v = Number(n);
  return Math.abs(v) >= 1e-6 ? v.toFixed(digits) : v.toExponential(2);
}
function prettyPct(n: number | undefined | null, digits = 2) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const v = Number(n);
  return Math.abs(v) >= 1e-6 ? v.toFixed(digits) : v.toExponential(2);
}

type Nucleus = { binIndex: number };
type FM = {
  // legacy
  gfm_price?: number;
  // new
  gfm_ref_price?: number;   // GFMr (anchor)
  gfm_calc_price?: number;  // GFMc (live)
  sigma?: number; zAbs?: number;
  vInner?: number; vOuter?: number;
  inertia?: number; disruption?: number;
  nuclei?: Nucleus[];
};
type Streams = {
  benchmark?: { prev: number; cur: number; greatest: number };
  pct24h?:    { prev: number; cur: number; greatest: number };
  pct_drv?:   { prev: number; cur: number; greatest: number };
};
type Shifts =
  | { nShifts: number; timelapseSec: number; latestTs: number }
  | number
  | undefined;

// NEW: cards contract from the API
type Cards = {
  opening?: { benchmark?: number; pct24h?: number };
  live?: { benchmark?: number; pct24h?: number; pct_drv?: number };
};

type CoinOut = {
  ok?: boolean;
  meta?: { uiEpoch?: number; [k: string]: any };
  n?: number; bins?: number;
  opening?: number;
  openingSet?: { benchmark: number; openingTs: number };
  sessionStats?: { priceMin: number; priceMax: number; benchPctMin: number; benchPctMax: number };
  stats?: { minPrice: number; maxPrice: number };
  fm?: FM;
  cards?: Cards;          // <-- NEW
  swaps?: number;
  shifts?: Shifts;
  shiftsBlock?: Shifts;
  shiftsLegacy?: Shifts;
  gfmDelta?: { absPct?: number; anchorPrice?: number | null; price?: number | null };
  shift_stamp?: boolean;
  streams?: Streams;
  hist?: { counts: number[] };
  lastUpdateTs?: number;
  [k: string]: any;
};

export default function CoinPanel({
  symbol,
  coin,
  histogram,
}: {
  symbol: string;
  coin?: CoinOut | null;
  histogram?: React.ReactNode;
}) {
  // -------- epoch-gated freeze (adopt data only when uiEpoch changes) --------
  const epoch = coin?.meta?.uiEpoch ?? 0;
  const lastEpochRef = React.useRef<number>(-1);
  const [frozen, setFrozen] = React.useState<CoinOut | null>(null);

  React.useEffect(() => {
    if (!coin) return;
    if (epoch !== lastEpochRef.current) {
      setFrozen(coin);
      lastEpochRef.current = epoch;
    }
  }, [coin, epoch]);

  // Render snapshot for shift-sensitive tiles; keep delta/live from latest 'coin'
  const render = frozen ?? coin ?? undefined;

  const ok = !!render?.ok;

  // Opening benchmark (snapshot) + caption with opening pct24h
  const openingFallback = render?.opening ?? render?.openingSet?.benchmark;
  const openingBench = render?.cards?.opening?.benchmark ?? openingFallback;
  const openingPct = render?.cards?.opening?.pct24h;

  // MIN/MAX (session)
  const minPrice = render?.sessionStats?.priceMin ?? render?.stats?.minPrice;
  const maxPrice = render?.sessionStats?.priceMax ?? render?.stats?.maxPrice;

  // unify shifts count and latestTs
  const shiftsBag = (render?.shifts ?? render?.shiftsBlock ?? render?.shiftsLegacy) as any;
  const shiftsCount = typeof shiftsBag === 'number' ? shiftsBag : shiftsBag?.nShifts;
  const latestTs = (shiftsBag?.latestTs ?? coin?.lastUpdateTs) as number | undefined;
  const latest = latestTs ? new Date(latestTs).toLocaleTimeString() : '—';

  // ------------------------------ GFM block ------------------------------
  // Anchor (GFMr) is from frozen snapshot; GFMc only for debug/fallback
  const gfmr = render?.fm?.gfm_ref_price ?? render?.fm?.gfm_price ?? null;
  const gfmc = coin?.fm?.gfm_calc_price ?? coin?.fm?.gfm_price ?? null;
  const gfmMain = gfmr ?? gfmc ?? null;

  // Delta uses latest price vs anchor (so it keeps ticking without unfreezing)
  const anchorForDelta = gfmr ?? render?.gfmDelta?.anchorPrice ?? null;
  const livePrice = coin?.gfmDelta?.price ?? null;
  const deltaAbsPct = coin?.gfmDelta?.absPct ?? null;
  const deltaAbsPrice =
    anchorForDelta !== null && livePrice !== null ? Math.abs(livePrice - anchorForDelta) : null;

  const gfmSub =
    deltaAbsPrice !== null && deltaAbsPct !== null ? (
      <div className="mt-0.5 text-[10px] leading-tight text-[var(--muted)]">
        GFMΔ = {pretty(deltaAbsPrice, 6)} ({prettyPct(deltaAbsPct, 2)}%)
      </div>
    ) : null;

  // ------------------------------ Live market card ------------------------------
  // This one should tick each refresh → read from *coin* (latest), fallback to snapshot
  const liveBench =
    coin?.cards?.live?.benchmark ??
    render?.cards?.live?.benchmark ??
    livePrice ??
    null;
  const livePct24h =
    coin?.cards?.live?.pct24h ??
    render?.cards?.live?.pct24h ??
    null;
  const livePctDrv =
    coin?.cards?.live?.pct_drv ??
    render?.cards?.live?.pct_drv ??
    null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] p-4">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded-md text-xs font-semibold bg-[var(--panel-2)] border border-[var(--border)]">
            {symbol}
          </span>
          <span className="text-xs text-[var(--muted)]">
            n={render?.n ?? '—'} · bins={render?.bins ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>epoch #{epoch}</span>
          <span>updated {latest}</span>
          {coin?.shift_stamp ? (
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 font-medium">
              SHIFT
            </span>
          ) : null}
        </div>
      </div>

      {!ok ? (
        <div className="text-sm text-[var(--muted)]">no data</div>
      ) : (
        <>
          {/* top metric row */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <Metric label="GFM" value={pretty(gfmMain)} accent="violet" sub={gfmSub} />
            <Metric label="σ" value={pretty(render?.fm?.sigma)} accent="cyan" />
            <Metric label="|z|" value={pretty(render?.fm?.zAbs)} accent="pink" />
            <Metric
              label="opening"
              value={pretty(openingBench)}
              accent="lime"
              sub={
                openingPct !== undefined && openingPct !== null ? (
                  <div className="mt-0.5 text-[10px] leading-tight text-[var(--muted)]">
                    {prettyPct(openingPct, 2)}%
                  </div>
                ) : undefined
              }
            />
          </div>

          {/* chart */}
          <div className="rounded-xl bg-[var(--panel-2)] border border-[var(--border)] p-2 mb-3">
            {histogram}
          </div>

          {/* MIN/MAX + Shifts + Live market card */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Card title="MIN / MAX" subtitle="price (session)">
              <div className="text-sm grid grid-cols-2 gap-x-3">
                <div className="text-[var(--muted)]">min</div>
                <div className="tabular-nums">{pretty(minPrice)}</div>
                <div className="text-[var(--muted)]">max</div>
                <div className="tabular-nums">{pretty(maxPrice)}</div>
              </div>
            </Card>

            <Card title="Shifts" subtitle="confirmed K-cycles">
              <div className="text-sm grid grid-cols-2 gap-x-3">
                <div className="text-[var(--muted)]">nShifts</div>
                <div className="tabular-nums">{shiftsCount ?? '—'}</div>
                <div className="text-[var(--muted)]">swaps</div>
                <div className="tabular-nums">{render?.swaps ?? '—'}</div>
                <div className="text-[var(--muted)]">timelapse</div>
                <div className="tabular-nums">
                  {typeof (shiftsBag as any)?.timelapseSec === 'number'
                    ? `${(shiftsBag as any).timelapseSec}s`
                    : '—'}
                </div>
              </div>
            </Card>

            {/* NEW: live-market card (updates on every fetch) */}
            <Card title="Live market" subtitle="benchmark · pct24h · pct_drv">
              <div className="text-xs grid grid-cols-2 gap-x-3 leading-relaxed">
                <div className="text-[var(--muted)]">benchmark</div>
                <div className="tabular-nums">{pretty(liveBench)}</div>
                <div className="text-[var(--muted)]">pct24h</div>
                <div className="tabular-nums">{prettyPct(livePct24h, 2)}%</div>
                <div className="text-[var(--muted)]">pct_drv</div>
                <div className="tabular-nums">{prettyPct(livePctDrv, 4)}%</div>
              </div>
            </Card>
          </div>

          {/* streams */}
          <StreamsTable streams={render?.streams} />

          {/* matrix-style detail */}
          <div className="mt-3 grid grid-cols-3 gap-y-1 text-sm">
            <Row k="vInner" v={pretty(render?.fm?.vInner, 2)} />
            <Row k="vOuter" v={pretty(render?.fm?.vOuter, 2)} />
            <Row k="inertia" v={pretty(render?.fm?.inertia, 3)} />
            <Row k="disruption" v={pretty(render?.fm?.disruption, 3)} />
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: 'violet' | 'cyan' | 'pink' | 'lime';
  sub?: React.ReactNode;
}) {
  const ring =
    accent === 'violet'
      ? 'shadow-[0_0_0_1px_rgba(155,100,255,0.25)_inset]'
      : accent === 'cyan'
      ? 'shadow-[0_0_0_1px_rgba(88,255,255,0.25)_inset]'
      : accent === 'pink'
      ? 'shadow-[0_0_0_1px_rgba(255,120,180,0.25)_inset]'
      : 'shadow-[0_0_0_1px_rgba(70,255,140,0.25)_inset]';
  return (
    <div className={`rounded-xl bg-[var(--panel-2)] border border-[var(--border)] ${ring} p-3`}>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-base font-medium tabular-nums">{value}</div>
      {sub}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--panel-2)] border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted)]">{title}</div>
      {subtitle && <div className="text-[10px] text-[var(--muted)]/70 mb-1">{subtitle}</div>}
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="text-[var(--muted)]">{k}</div>
      <div className="col-span-2 tabular-nums">{v}</div>
    </>
  );
}
