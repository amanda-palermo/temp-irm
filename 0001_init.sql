-- Radar RI - schema inicial (Painel CASH3 > Visao Geral)
-- Rode este arquivo no Supabase (SQL Editor) uma unica vez, na ordem: 0001, depois 0002.

create table if not exists public.instruments (
  ticker        text primary key,          -- ex: 'CASH3', 'MELI', 'IBOV', 'BTCBRL'
  display_name  text not null,              -- ex: 'Meliuz', 'Mercado Livre'
  category      text not null,              -- 'Meliuz' | 'Tecnologia' | 'Varejo' | 'Bitcoin Treasury' | 'Indices e cambio'
  kind          text not null,              -- 'stock' | 'index' | 'crypto' | 'fx'
  exchange      text,                       -- 'BVMF' | 'NASDAQ' | 'NYSE' | 'EPA' | 'OTCMKTS' | null
  currency      text not null default 'BRL',
  sort_order    int not null default 0
);

create table if not exists public.market_data_daily (
  ticker            text not null references public.instruments(ticker),
  trade_date        date not null,
  price             numeric,
  volume            bigint,
  financial_volume  numeric,
  inserted_at       timestamptz not null default now(),
  primary key (ticker, trade_date)
);
create index if not exists idx_market_data_daily_date on public.market_data_daily (trade_date desc);

-- Snapshot (nao e serie historica): quantidade de acoes em circulacao, usada para
-- calcular market cap = preco x quantidade. Quando a quantidade e desconhecida,
-- usamos market_cap_override (valor ja pronto, vindo de fonte externa).
create table if not exists public.shares_outstanding (
  ticker               text primary key references public.instruments(ticker),
  shares               bigint,
  market_cap_override  numeric,
  as_of_date           date,
  source_url           text,
  updated_at           timestamptz not null default now()
);

create table if not exists public.treasury_yields (
  series_id  text not null,   -- 'DGS5' | 'DGS10'
  obs_date   date not null,
  value      numeric,
  primary key (series_id, obs_date)
);
create index if not exists idx_treasury_yields_date on public.treasury_yields (obs_date desc);

-- Row Level Security: leitura publica (o site le so com a anon key),
-- escrita apenas via service_role key (usada pelo GitHub Actions, nunca exposta no site).
alter table public.instruments        enable row level security;
alter table public.market_data_daily  enable row level security;
alter table public.shares_outstanding enable row level security;
alter table public.treasury_yields    enable row level security;

drop policy if exists "public read instruments" on public.instruments;
create policy "public read instruments" on public.instruments
  for select using (true);

drop policy if exists "public read market_data_daily" on public.market_data_daily;
create policy "public read market_data_daily" on public.market_data_daily
  for select using (true);

drop policy if exists "public read shares_outstanding" on public.shares_outstanding;
create policy "public read shares_outstanding" on public.shares_outstanding
  for select using (true);

drop policy if exists "public read treasury_yields" on public.treasury_yields;
create policy "public read treasury_yields" on public.treasury_yields
  for select using (true);

-- View de conveniencia: ultima posicao de cada instrumento + market cap calculado.
create or replace view public.latest_market_snapshot as
select
  i.ticker,
  i.display_name,
  i.category,
  i.kind,
  i.exchange,
  i.currency,
  m.trade_date,
  m.price,
  m.volume,
  m.financial_volume,
  s.shares,
  s.market_cap_override,
  coalesce(s.market_cap_override, m.price * s.shares) as market_cap
from public.instruments i
left join lateral (
  select trade_date, price, volume, financial_volume
  from public.market_data_daily md
  where md.ticker = i.ticker
  order by md.trade_date desc
  limit 1
) m on true
left join public.shares_outstanding s on s.ticker = i.ticker;
