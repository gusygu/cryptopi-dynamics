-- =====================================================================
-- CryptoPi • ddl-aux.sql (UNIFIED AUX + INGEST + LEDGER)
-- Idempotent: safe to run multiple times.
-- Design: Ingest once (Binance → DB); compute from DB; persist AUX outputs.
-- =====================================================================

-- 0) Core refs ----------------------------------------------------------
create table if not exists app_sessions (
  app_session_id text primary key,
  started_at     timestamptz not null default now()
);

create table if not exists coins (
  symbol text primary key
);

create table if not exists pairs (
  base  text not null references coins(symbol),
  quote text not null references coins(symbol),
  primary key (base, quote)
);

-- Optional cycle clock (40s)
create table if not exists cycles (
  cycle_ts bigint primary key,  -- epoch ms
  created_at timestamptz not null default now()
);

-- 1) Ingestion staging (Binance raw JSON) -------------------------------
create table if not exists binance_balances_raw (
  app_session_id text not null references app_sessions(app_session_id),
  fetched_at_ms  bigint not null,
  payload        jsonb  not null,
  primary key (app_session_id, fetched_at_ms)
);

create table if not exists binance_trades_raw (
  app_session_id text not null references app_sessions(app_session_id),
  fetched_at_ms  bigint not null,
  payload        jsonb  not null,
  primary key (app_session_id, fetched_at_ms)
);

-- 2) Canonical normalized inputs for AUX computations -------------------
-- Wallet qty per coin per cycle (native units)
create table if not exists wallet_snapshots (
  app_session_id text not null references app_sessions(app_session_id),
  cycle_ts       bigint not null references cycles(cycle_ts),
  symbol         text   not null references coins(symbol),
  qty            double precision not null,
  primary key (app_session_id, cycle_ts, symbol)
);
create index if not exists idx_wallet_snapshots_session_ts on wallet_snapshots(app_session_id, cycle_ts desc);

-- USDT price per coin per cycle
create table if not exists prices_usdt (
  cycle_ts   bigint not null references cycles(cycle_ts),
  symbol     text   not null references coins(symbol),
  price_usdt double precision not null,
  primary key (cycle_ts, symbol)
);

-- MEA “orientational” (pair-based) per cycle
-- value is your orientational metric (e.g., id_pct_unified, or a composite GFM later)
create table if not exists mea_orientations (
  cycle_ts bigint not null references cycles(cycle_ts),
  base     text   not null references coins(symbol),
  quote    text   not null references coins(symbol),
  metric   text   not null default 'id_pct',      -- name of the orientational metric
  value    double precision not null,             -- decimal (0.00002 == 0.002%)
  primary key (cycle_ts, base, quote, metric)
);

-- Ensure mea_unified_refs is a VIEW (drop legacy TABLE if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mea_unified_refs' AND c.relkind = 'r'  -- table
  ) THEN
    EXECUTE 'DROP TABLE IF EXISTS mea_unified_refs CASCADE';
  END IF;
END $$;

create or replace view mea_unified_refs as
select
  o.cycle_ts,
  o.base as symbol,
  avg(o.value) as id_pct
from mea_orientations o
where o.metric = 'id_pct'
group by 1,2;




-- Convenience: symbol-level unified reference (e.g., quote=USDT collapsed)
-- If you prefer symbol-level expectations for CIN (USDT-bridged), materialize them here.
create or replace view mea_unified_refs as
select
  o.cycle_ts,
  o.base as symbol,
  avg(o.value) as id_pct               -- simple averaging across quotes; customize if needed
from mea_orientations o
where o.metric = 'id_pct'
group by 1,2;

-- 3) Transfer Attribution Ledger (execution-aware journal) --------------
create table if not exists transfer_ledger (
  app_session_id   text   not null references app_sessions(app_session_id),
  cycle_ts         bigint not null references cycles(cycle_ts),
  leg_seq          integer not null,
  route_id         text,
  intent_id        text,
  from_symbol      text not null references coins(symbol),
  to_symbol        text not null references coins(symbol),
  qty_from         double precision not null,
  qty_to           double precision not null,
  price_from_usdt  double precision not null,
  price_to_usdt    double precision not null,
  fee_usdt         double precision not null default 0,
  exec_ts          bigint not null,
  tx_id            text,
  primary key (app_session_id, cycle_ts, leg_seq)
);
create index if not exists idx_ledger_session_ts on transfer_ledger(app_session_id, cycle_ts);
create index if not exists idx_ledger_symbols on transfer_ledger(from_symbol, to_symbol);

create or replace view v_transfer_ledger_rollup as
with legs as (
  select
    app_session_id,
    cycle_ts,
    from_symbol,
    to_symbol,
    (qty_to   * price_to_usdt)   as inflow_to_usdt,
    (qty_from * price_from_usdt) as outflow_from_usdt,
    ((qty_to * price_to_usdt) - (qty_from * price_from_usdt) - fee_usdt) as profit_leg_usdt,
    fee_usdt
  from transfer_ledger
),
sym_flow as (
  select app_session_id, cycle_ts, symbol, 
         sum(inflow_usdt)  as inflow_usdt,
         sum(outflow_usdt) as outflow_usdt,
         sum(fees_usdt)    as fees_usdt
  from (
    select app_session_id, cycle_ts, to_symbol   as symbol, inflow_to_usdt   as inflow_usdt, 0                 as outflow_usdt, fee_usdt as fees_usdt from legs
    union all
    select app_session_id, cycle_ts, from_symbol as symbol, 0                as inflow_usdt, outflow_from_usdt as outflow_usdt, 0        as fees_usdt from legs
  ) x
  group by app_session_id, cycle_ts, symbol
),
sym_profit as (
  select app_session_id, cycle_ts, to_symbol as symbol, sum(profit_leg_usdt) as realized_profit_usdt
  from legs
  group by app_session_id, cycle_ts, to_symbol
)
select
  f.app_session_id,
  f.cycle_ts,
  f.symbol,
  coalesce(f.inflow_usdt, 0)           as inflow_usdt,
  coalesce(f.outflow_usdt, 0)          as outflow_usdt,
  coalesce(p.realized_profit_usdt, 0)  as realized_profit_usdt,
  coalesce(f.fees_usdt, 0)             as fees_usdt
from sym_flow f
left join sym_profit p
  on p.app_session_id = f.app_session_id
 and p.cycle_ts      = f.cycle_ts
 and p.symbol        = f.symbol;

-- 4) CIN (cycle + session accumulators) ---------------------------------
create table if not exists cin_aux_cycle (
  app_session_id        text   not null references app_sessions(app_session_id),
  cycle_ts              bigint not null references cycles(cycle_ts),
  symbol                text   not null references coins(symbol),
  wallet_usdt           double precision not null,
  profit_usdt           double precision not null default 0,  -- realized (ledger) or expected fallback
  imprint_cycle_usdt    double precision not null default 0,
  luggage_cycle_usdt    double precision not null default 0,
  primary key (app_session_id, cycle_ts, symbol)
);
create index if not exists idx_cin_aux_cycle_session_ts on cin_aux_cycle (app_session_id, cycle_ts desc);

create table if not exists cin_aux_session_acc (
  app_session_id     text not null references app_sessions(app_session_id),
  symbol             text not null references coins(symbol),
  imprint_acc_usdt   double precision not null default 0,
  luggage_acc_usdt   double precision not null default 0,
  primary key (app_session_id, symbol)
);

create or replace view v_cin_aux as
select
  c.app_session_id,
  c.cycle_ts,
  c.symbol,
  c.wallet_usdt,
  c.profit_usdt,
  c.imprint_cycle_usdt,
  c.luggage_cycle_usdt,
  coalesce(a.imprint_acc_usdt, 0) as imprint_app_session_usdt,
  coalesce(a.luggage_acc_usdt, 0) as luggage_app_session_usdt
from cin_aux_cycle c
left join cin_aux_session_acc a
  on a.app_session_id = c.app_session_id
 and a.symbol        = c.symbol;

-- 5) MEA (snapshots / audit) --------------------------------------------
-- keep a doc-like snapshot for replay / audit of orientational grids
create table if not exists aux_mea_snapshots (
  ts_ms      bigint       not null,
  coins      text[]       not null,
  k          int          not null,
  grid       jsonb        not null,
  warnings   text[]       not null default '{}',
  created_at timestamptz  not null default now()
);

-- Optional helper index if your dyn_matrix_values table exists
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'dyn_matrix_values') then
    create index if not exists idx_dyn_matrix_values_latest
      on dyn_matrix_values (matrix_type, ts_ms desc, base, quote);
  end if;
end $$;

-- 6) Unified AUX overview (handy for dashboards) ------------------------
create or replace view v_aux_overview as
select
  c.app_session_id,
  c.cycle_ts,
  c.symbol,
  c.wallet_usdt,
  c.profit_usdt,
  c.imprint_cycle_usdt,
  c.luggage_cycle_usdt,
  v.imprint_app_session_usdt,
  v.luggage_app_session_usdt
from cin_aux_cycle c
left join v_cin_aux v using (app_session_id, cycle_ts, symbol);
