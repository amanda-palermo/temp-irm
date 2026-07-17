-- Radar RI - schema do assistente de IA (base de documentos para RAG)
-- Rode depois do 0001, 0002, 0003 e 0004. E idempotente.
-- Uso interno (time de RI): ao contrario das tabelas do Painel CASH3, aqui NAO existe
-- policy de leitura publica. So o backend do assistente acessa, via service_role key
-- (que ignora RLS por padrao no Supabase).
--
-- Escopo: todo conteudo textual/documental do site de RI (nao so fatos relevantes) -
-- Sobre a Meliuz, Governanca (estatuto/politicas/atas), Central de resultados, Fatos
-- relevantes e comunicados, Apresentacoes, Formulario de Referencia, FAQ. Conteudo
-- tabular do site (composicao acionaria, valores mobiliarios negociados, calendario
-- de eventos, cobertura de analistas) NAO entra aqui - vira tabela estruturada
-- propria (mesmo padrao de instruments/shares_outstanding), porque RAG e ruim pra
-- responder pergunta exata sobre dado tabular.

create extension if not exists vector;

-- Um documento de RI (fato relevante, ata de assembleia, estatuto, apresentacao,
-- FAQ, etc), identificado pela URL de origem.
create table if not exists public.ri_documents (
  id              bigserial primary key,
  url             text not null unique,   -- ex: link de Download.aspx do site de RI
  title           text not null,          -- ex: 'Negociacoes atipicas de valores mobiliarios'
  canal           text not null,          -- ex: 'Fatos relevantes e comunicados', 'Governanca Corporativa', 'Central de resultados'
  published_date  date,
  inserted_at     timestamptz not null default now()
);

-- Pedacos de texto do documento, ja prontos para busca vetorial (RAG).
-- embedding: dimensao 1024 = padrao do voyage-4 (tambem padrao do voyage-3-large;
-- ajustar se trocar de modelo ou de dimensao - ver docs.voyageai.com/docs/embeddings).
create table if not exists public.ri_document_chunks (
  id           bigserial primary key,
  document_id  bigint not null references public.ri_documents(id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  embedding    vector(1024),
  inserted_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

-- Indice para busca por similaridade (distancia de cosseno). hnsw (em vez de
-- ivfflat) porque se ajusta de forma incremental a cada insert, sem precisar
-- popular a tabela antes ou reindexar depois - mais simples de manter numa
-- base que ainda vai crescer (poucos milhares de chunks esperados).
create index if not exists idx_ri_document_chunks_embedding
  on public.ri_document_chunks
  using hnsw (embedding vector_cosine_ops);

alter table public.ri_documents        enable row level security;
alter table public.ri_document_chunks  enable row level security;

-- Nenhuma policy de select/insert criada de proposito: sem policy, RLS bloqueia
-- todo acesso via anon/authenticated key. O backend do assistente usa a
-- service_role key (Coolify), que sempre ignora RLS.
