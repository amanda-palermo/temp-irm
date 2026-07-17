# Radar RI — Painel CASH3 (Méliuz)

Site de relações com investidores da Méliuz. Nesta primeira fase, só a tela
**Painel CASH3 > Visão geral** está implementada com dados reais. As telas de
base acionária ficam para depois (dependem de autorização para dados
sensíveis de acionistas) e o **Assistente de IA** é a próxima etapa.

## Como os dados chegam até o site

```
Google Sheets (cotações via Google Finance)  ─┐
FRED (US Treasury 5Y / 10Y)                   ├─► GitHub Actions (1x/dia) ─► Supabase ─► site estático (GitHub Pages)
```

- O **GitHub Actions** roda `scripts/sync-market-data.mjs` uma vez por dia (dias
  úteis, 18:30 horário de Brasília) e grava no Supabase usando a
  `service_role key` (fica só nos Secrets do GitHub, nunca no site).
- O **site estático** (pasta `docs/`) lê do Supabase usando a `anon key`
  (essa é pública por design — só permite leitura, graças ao Row Level
  Security configurado no schema).

## Passo a passo para colocar no ar

### 1. Rodar o SQL no Supabase

No painel do Supabase: **SQL Editor** → cole e rode, nesta ordem:

1. `supabase/migrations/0001_init.sql` (cria as tabelas e as políticas de RLS)
2. `supabase/migrations/0002_seed_instruments.sql` (cadastra os tickers e a
   quantidade de ações mais recente)
3. `supabase/migrations/0003_add_ir_url.sql` (adiciona o link do site de RI de
   cada empresa/peer, usado na tabela "Comparativo com peers")
4. `supabase/migrations/0004_shares_history.sql` (cria o histórico de
   quantidade de ações em circulação da CASH3, usado para calcular o KPI
   "Total de ações em circulação" e o "Valor de mercado" corretamente em
   qualquer data selecionada, não só na mais recente)
5. `supabase/migrations/0005_ri_documents.sql` (cria as tabelas de documentos
   e embeddings usadas pelo **Assistente de IA**, ainda em construção —
   ver `scripts/ingest-ri-documents.mjs`)

Pode rodar de novo sem medo — os cinco arquivos são idempotentes (fazem
`upsert`/`update`, não duplicam nada).

### 2. Descobrir o `gid` da aba "Quantidade de ações para calcular mkt cap"

Abra a planilha, clique na aba "Quantidade de ações para calcular mkt cap" e
copie o número que aparece depois de `gid=` na URL. Guarde esse número — ele
vai para o secret `SHEET_GID_ACOES` no passo 4.

### 3. Preencher a configuração pública do site

✅ Já preenchido em `docs/js/config.js` com a URL e a **publishable key**
do projeto (equivalente à antiga "anon key" — o Supabase renomeou esse tipo
de chave, mas o uso é o mesmo). Essas duas informações não são secretas —
foram feitas para ficar exposta no navegador, protegidas pelo RLS.

### 4. Configurar os Secrets do GitHub Actions

No repositório do GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Crie estes 8 secrets:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | mesma URL do passo 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` (⚠️ nunca cole isso em nenhum arquivo do repositório) |
| `SHEET_ID` | `1cPyArNy99U6sTJaHDNqUjRO2DN9wv-UJus-I9DKf-YE` |
| `SHEET_GID_COTACOES` | `0` |
| `SHEET_GID_COTACOES_HISTORICO` | `568641663` (aba de cotações históricas em valor fixo — reforço para quando a fórmula GOOGLEFINANCE retorna `#N/A` na exportação) |
| `SHEET_GID_ACOES` | o número que você pegou no passo 2 |
| `SHEET_GID_SHARES_HISTORY` | `277174716` (aba com o histórico de mudanças na qtde de ações) |
| `SHEET_GID_IR_LINKS` | `435768027` (aba "Site RI") |

`FRED_API_KEY` é opcional — só precisa se o endpoint público do FRED
(`fredgraph.csv`) parar de funcionar (cadastro grátis em
https://fred.stlouisfed.org/docs/api/api_key.html).

### 5. Subir o código para o GitHub (upload manual, pelo site)

Sem precisar instalar Git nem usar linha de comando:

1. Abra o seu repositório em github.com → botão **Add file → Upload files**.
2. Arraste a pasta **inteira** `radar ri` (ou todo o conteúdo dela) para a
   área de upload. O GitHub recria a estrutura de pastas sozinho a partir do
   que você arrastar.
3. **Atenção especial à pasta `.github/workflows/`** — como o nome começa
   com ponto, é fácil ela passar despercebida. Confirme que o arquivo
   `.github/workflows/sync-market-data.yml` apareceu na lista de arquivos
   antes de commitar (role a lista de arquivos que o GitHub vai subir). Se
   não aparecer, arraste esse arquivo separadamente.
4. Role até o fim da página, escreva uma mensagem de commit (ex: "Painel
   CASH3: primeira versão") e clique em **Commit changes** (direto na
   branch `main`).

Depois disso, qualquer ajuste pontual (como preencher o `docs/js/config.js`
do passo 3) também pode ser feito direto pelo site: abra o arquivo no
GitHub, clique no ícone de lápis (Edit), altere e commite.

### 6. Rodar o sync pela primeira vez

No GitHub, aba **Actions** → workflow "Sync market data" → botão **Run
workflow** (não precisa esperar o horário agendado). Isso faz o backfill de
todo o histórico da planilha de uma vez. Confira o log da execução — se algo
der erro (ex: secret errado, gid errado), aparece ali.

### 7. Publicar no GitHub Pages

Settings → Pages → Branch: `main` → Folder: `/docs` (o GitHub Pages, no modo
"Deploy from a branch", só aceita `/(root)` ou `/docs` — por isso o site fica
na pasta `docs/` e não `public/`). Mais pra frente, se quiser publicar de
outro jeito (ex: Coolify), é só trocar o método de deploy.

### 8. Testar localmente antes de tudo isso (opcional)

```
cp .env.example .env   # preencha com seus valores
npm install
npm run sync
```

## O que ainda não está implementado (de propósito)

- **Total de acionistas** e **Free float** aparecem com "—" no lugar do
  número — dependem da base de acionistas, que ainda não temos autorização
  para tratar.
- Seção de notícias, aba "Maiores acionistas", "Movimentações",
  "Comportamento & ranking", "Segmentação" e "Assistente de IA" do wireframe
  original ainda não foram construídas — ficam para as próximas etapas.
- Fontes customizadas do wireframe original foram trocadas por fontes de
  sistema (o arquivo original embutia uma fonte proprietária como base64;
  isso não faz sentido manter num repositório de produção sem checar a
  licença).
