-- Radar RI - seed de instrumentos e quantidade de acoes
-- Rode depois do 0001_init.sql. E seguro rodar de novo (idempotente).

insert into public.instruments (ticker, display_name, category, kind, exchange, currency, sort_order) values
  ('CASH3', 'Meliuz',                       'Meliuz',            'stock', 'BVMF',    'BRL', 10),

  ('TOTS3', 'Totvs',                        'Tecnologia',        'stock', 'BVMF',    'BRL', 20),
  ('BMOB3', 'Bemobi',                       'Tecnologia',        'stock', 'BVMF',    'BRL', 21),
  ('LWSA3', 'Locaweb',                      'Tecnologia',        'stock', 'BVMF',    'BRL', 22),
  ('DOTZ3', 'Dotz',                         'Tecnologia',        'stock', 'BVMF',    'BRL', 23),
  ('INTB3', 'Intelbras',                    'Tecnologia',        'stock', 'BVMF',    'BRL', 24),
  ('IBTA',  'iBotta',                       'Tecnologia',        'stock', 'NYSE',    'USD', 25),

  ('AMER3', 'Americanas',                   'Varejo',            'stock', 'BVMF',    'BRL', 30),
  ('MGLU3', 'Magazine Luiza',                'Varejo',            'stock', 'BVMF',    'BRL', 31),
  ('ALPA4', 'Alpargatas',                    'Varejo',            'stock', 'BVMF',    'BRL', 32),
  ('BHIA3', 'Grupo Casas Bahia',             'Varejo',            'stock', 'BVMF',    'BRL', 33),
  ('RADL3', 'RaiaDrogasil',                  'Varejo',            'stock', 'BVMF',    'BRL', 34),
  ('MELI',  'Mercado Livre',                 'Varejo',            'stock', 'NASDAQ',  'USD', 35),
  ('AZZA3', 'Azzas 2154',                    'Varejo',            'stock', 'BVMF',    'BRL', 36),

  ('OBTC3', 'OranjeBTC',                     'Bitcoin Treasury',  'stock', 'BVMF',    'BRL', 40),
  ('MSTR',  'Strategy',                      'Bitcoin Treasury',  'stock', 'NASDAQ',  'USD', 41),
  ('XYZ',   'Block, Inc.',                   'Bitcoin Treasury',  'stock', 'NYSE',    'USD', 42),
  ('ALCPB', 'Capital B (Blockchain Group)',  'Bitcoin Treasury',  'stock', 'EPA',     'EUR', 43),
  ('MTPLF', 'Metaplanet',                    'Bitcoin Treasury',  'stock', 'OTCMKTS', 'USD', 44),

  ('IBOV',   'Ibovespa',                     'Indices e cambio',  'index', 'BVMF',    'BRL', 50),
  ('IXIC',   'Nasdaq Composite',             'Indices e cambio',  'index', 'NASDAQ',  'USD', 51),
  ('BTCBRL', 'Bitcoin (BTC/BRL)',            'Indices e cambio',  'crypto', null,     'BRL', 52),
  ('BTCUSD', 'Bitcoin (BTC/USD)',            'Indices e cambio',  'crypto', null,     'USD', 53),
  ('USDBRL', 'Dolar (USD/BRL)',              'Indices e cambio',  'fx',     null,     'BRL', 54),
  ('EURBRL', 'Euro (EUR/BRL)',               'Indices e cambio',  'fx',     null,     'BRL', 55)
on conflict (ticker) do update set
  display_name = excluded.display_name,
  category     = excluded.category,
  kind         = excluded.kind,
  exchange     = excluded.exchange,
  currency     = excluded.currency,
  sort_order   = excluded.sort_order;

-- Quantidade de acoes / market cap (aba "Quantidade de acoes para calcular mkt cap", posicao de 17/06/2026).
-- Isto NAO e serie historica: e sobrescrito a cada sync com o estado mais recente da planilha.
insert into public.shares_outstanding (ticker, shares, market_cap_override, as_of_date, source_url) values
  ('CASH3', 113226097,  null, '2026-06-17', null),
  ('BMOB3', 85608392,   null, '2026-06-17', null),
  ('LWSA3', 568561350,  null, '2026-06-17', null),
  ('TOTS3', 599401581,  null, '2026-06-17', null),
  ('DOTZ3', 13321978,   null, '2026-06-17', null),
  ('INTB3', 327611110,  null, '2026-06-17', null),
  ('IBTA',  21212756,   null, '2026-06-17', null),
  ('AMER3', 200245278,  null, '2026-06-17', null),
  ('MGLU3', 775945010,  null, '2026-06-17', null),
  ('ALPA4', 343551533,  null, '2026-06-17', null),
  ('BHIA3', 975864785,  null, '2026-06-17', null),
  ('RADL3', 1752367344, null, '2026-06-17', null),
  ('MELI',  null, 84871000000.00, '2026-06-17', 'https://br.investing.com/pro/NYSE:XYZ/explorer/marketcap_adj'),
  ('AZZA3', 206489813,  null, '2026-06-17', null),
  ('OBTC3', 168608200,  null, '2026-06-17', null),
  ('MSTR',  null, 43180000000.00, '2026-06-17', 'https://br.investing.com/pro/NYSE:XYZ/explorer/marketcap_adj'),
  ('XYZ',   null, 44862000000.00, '2026-06-17', 'https://br.investing.com/pro/NYSE:XYZ/explorer/marketcap_adj'),
  ('ALCPB', 229727727,  null, '2026-06-17', null),
  ('MTPLF', 1279913624, null, '2026-06-17', null)
on conflict (ticker) do update set
  shares               = excluded.shares,
  market_cap_override  = excluded.market_cap_override,
  as_of_date           = excluded.as_of_date,
  source_url           = excluded.source_url,
  updated_at           = now();
