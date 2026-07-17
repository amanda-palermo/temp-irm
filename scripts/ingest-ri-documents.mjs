// Radar RI - ingestao inicial de documentos de RI para o assistente (RAG)
//
// Roda via `npm run ingest`. Precisa das variaveis de ambiente descritas em
// .env.example (localmente via arquivo .env).
//
// Escopo desta primeira leva: so "Fatos relevantes e comunicados", a partir do
// arquivo scripts/seed-data/ri-index-fatos-relevantes.json - um seed ja extraido
// e pre-dividido em chunks (chunk_id + texto) do site de RI. Nao faz scraping
// nem OCR ainda: isso fica para uma proxima etapa, quando formos manter a base
// atualizada com documentos novos e cobrir outras secoes do site (ver README
// / secao "O que ainda nao esta implementado").
//
// Este script e idempotente: pode rodar quantas vezes quiser que so faz upsert
// (nao duplica documento nem chunk).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "seed-data", "ri-index-fatos-relevantes.json");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY } = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}. Veja .env.example.`);
  }
  return value;
}

requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
requireEnv("VOYAGE_API_KEY", VOYAGE_API_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const VOYAGE_MODEL = "voyage-4"; // 1024 dims (padrao) - tem que bater com supabase/migrations/0005_ri_documents.sql. Entra no tier gratuito de 200M tokens da Voyage.
const VOYAGE_BATCH_SIZE = 32; // bem abaixo do limite da API, seguranca contra erro de payload/rate limit

// ---------------------------------------------------------------------------
// Seed: agrupa as linhas (1 por chunk) em documentos (1 por url)
// ---------------------------------------------------------------------------
function parseBrDate(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw ?? ""));
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function loadSeedDocuments() {
  const rows = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  const byUrl = new Map();

  for (const row of rows) {
    if (!byUrl.has(row.url)) {
      byUrl.set(row.url, {
        url: row.url,
        title: row.doc,
        canal: row.canal,
        published_date: parseBrDate(row.data),
        chunks: [],
      });
    }
    byUrl.get(row.url).chunks.push({ chunk_index: row.chunk_id, content: row.texto });
  }

  for (const doc of byUrl.values()) {
    doc.chunks.sort((a, b) => a.chunk_index - b.chunk_index);
  }

  return [...byUrl.values()];
}

// ---------------------------------------------------------------------------
// Voyage AI - embeddings em lote (input_type "document": texto que vai ser
// indexado e buscado depois; e diferente do input_type "query" que o backend
// do assistente vai usar na hora da pergunta - ver docs da Voyage).
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Conta sem cartao cadastrado na Voyage cai pra 3 requisicoes/minuto (os tokens
// gratis continuam valendo do mesmo jeito - e so limite de velocidade). Em vez
// de exigir cartao pra rodar uma ingestao unica, esperamos e tentamos de novo.
async function embedBatch(texts, attempt = 1) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: "document" }),
  });

  if (res.status === 429 && attempt <= 8) {
    const retryAfterSec = Number(res.headers.get("retry-after")) || 25;
    console.warn(`[voyage] rate limit (429), tentativa ${attempt}/8 - aguardando ${retryAfterSec}s...`);
    await sleep(retryAfterSec * 1000);
    return embedBatch(texts, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Voyage AI falhou: HTTP ${res.status} - ${await res.text()}`);
  }
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

async function embedAll(texts) {
  const embeddings = [];
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH_SIZE) {
    const batch = texts.slice(i, i + VOYAGE_BATCH_SIZE);
    const batchEmbeddings = await embedBatch(batch);
    embeddings.push(...batchEmbeddings);
    console.log(`[voyage] embeddings ${Math.min(i + VOYAGE_BATCH_SIZE, texts.length)}/${texts.length}`);
  }
  return embeddings;
}

// pgvector via supabase-js: o cliente nao tem tipo nativo pra "vector", entao
// mandamos como texto no formato que o Postgres entende ("[0.1,0.2,...]") e o
// Postgres faz o cast implicito pra vector na hora do insert.
function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("== Radar RI: ingestao de documentos de RI (Fatos relevantes e comunicados) ==");

  const documents = loadSeedDocuments();
  console.log(`[1/3] ${documents.length} documento(s) no seed, ${documents.reduce((n, d) => n + d.chunks.length, 0)} chunk(s) no total.`);

  console.log("[2/3] Upsert de documentos (ri_documents)...");
  const { data: upsertedDocs, error: docsError } = await supabase
    .from("ri_documents")
    .upsert(
      documents.map((d) => ({
        url: d.url,
        title: d.title,
        canal: d.canal,
        published_date: d.published_date,
      })),
      { onConflict: "url" },
    )
    .select("id, url");
  if (docsError) throw new Error(`Erro no upsert de ri_documents: ${docsError.message}`);

  const documentIdByUrl = new Map(upsertedDocs.map((d) => [d.url, d.id]));

  console.log("[3/3] Gerando embeddings e salvando chunks (ri_document_chunks)...");
  for (const doc of documents) {
    const documentId = documentIdByUrl.get(doc.url);
    const texts = doc.chunks.map((c) => c.content);
    const embeddings = await embedAll(texts);

    const chunkRows = doc.chunks.map((c, i) => ({
      document_id: documentId,
      chunk_index: c.chunk_index,
      content: c.content,
      embedding: toVectorLiteral(embeddings[i]),
    }));

    const { error: chunksError } = await supabase
      .from("ri_document_chunks")
      .upsert(chunkRows, { onConflict: "document_id,chunk_index" });
    if (chunksError) throw new Error(`Erro no upsert de chunks de "${doc.title}": ${chunksError.message}`);

    console.log(`  - "${doc.title}" (${doc.published_date ?? "sem data"}): ${chunkRows.length} chunk(s) ok`);
  }

  console.log("== Ingestao concluida com sucesso ==");
}

main().catch((err) => {
  console.error("Ingestao falhou:", err);
  process.exit(1);
});
