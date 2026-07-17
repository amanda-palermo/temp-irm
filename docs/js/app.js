// Radar RI - Painel CASH3 > Visao Geral
// Le tudo do Supabase (populado pelo GitHub Actions a partir da planilha + FRED).
// Nao ha nenhum dado mockado aqui: onde a informacao ainda nao existe (base de
// acionistas, free float), a tela mostra um traco em vez de inventar um numero.
//
// Tudo na tela (KPIs, graficos, tabela de peers) e recalculado a partir da
// data escolhida no seletor: mudar a data recorta todas as series ate aquele
// dia e redesenha a pagina inteira "como se aquele fosse o dia atual".

const MONTH_LOOKBACK = 21;  // ~1 mes de pregoes
const YEAR_LOOKBACK = 252;  // ~12 meses de pregoes
const PAGE_SIZE = 1000;     // o Supabase limita cada resposta a 1000 linhas por padrao;
                             // paginamos com .range() em vez de depender de mudar essa configuracao

const cfg = window.RADAR_RI_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Tema claro/escuro (persistido no navegador; sem escolha manual, segue o SO)
// ---------------------------------------------------------------------------
function currentTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function chartSecondaryColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--chart-line-secondary").trim() || "#2A2A2A";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("radar-ri-theme", theme);
  } catch (e) {}
  document.getElementById("theme-light-btn")?.classList.toggle("active", theme === "light");
  document.getElementById("theme-dark-btn")?.classList.toggle("active", theme === "dark");
  // recoloreia os graficos (a cor do IBOV muda entre os temas para continuar visivel)
  const dateSelect = document.getElementById("kpi-date-select");
  if (dateSelect && dateSelect.value) renderForDate(dateSelect.value);
}
document.getElementById("theme-light-btn")?.addEventListener("click", () => applyTheme("light"));
document.getElementById("theme-dark-btn")?.addEventListener("click", () => applyTheme("dark"));
applyTheme(currentTheme());

// ---------------------------------------------------------------------------
// Navegacao entre "abas" (Painel CASH3 / Metodologia) - tudo na mesma pagina,
// so mostra/esconde a section correspondente.
// ---------------------------------------------------------------------------
document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const view = link.getAttribute("data-view");
    document.querySelectorAll(".nav-link[data-view]").forEach((l) => l.classList.toggle("active", l === link));
    document.querySelectorAll(".view").forEach((v) => {
      v.style.display = v.id === `view-${view}` ? "" : "none";
    });
  });
});

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------
const NBSP = " "; // espaco que nao quebra linha (evita "R$ 710,0" quebrar antes de "mi")
function currencySymbol(currency) {
  return currency === "USD" ? "US$" : currency === "EUR" ? "€" : "R$";
}
function fmtPrice(value, currency) {
  if (value == null || !isFinite(value)) return "—";
  return currencySymbol(currency) + NBSP + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(value) {
  if (value == null || !isFinite(value)) return "—";
  return Math.round(value).toLocaleString("pt-BR");
}
function fmtPct(value, digits = 1) {
  if (value == null || !isFinite(value)) return "—";
  const s = (value * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (value > 0 ? "+" : "") + s + "%";
}
function fmtMoneyAuto(value, currency) {
  if (value == null || !isFinite(value)) return "—";
  const symbol = currencySymbol(currency);
  if (Math.abs(value) >= 1e9) return symbol + NBSP + (value / 1e9).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + NBSP + "bi";
  return symbol + NBSP + (value / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + NBSP + "mi";
}
function fmtDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function deltaClass(v) {
  return v > 0.0001 ? "up" : v < -0.0001 ? "down" : "flat";
}
function arrow(v) {
  return v > 0.0001 ? "▲" : v < -0.0001 ? "▼" : "–";
}

// ---------------------------------------------------------------------------
// Acesso a dados (busca tudo uma vez; a navegacao por data so recorta em memoria)
// ---------------------------------------------------------------------------
async function fetchInstruments() {
  const { data, error } = await sb.from("instruments").select("*").order("sort_order");
  if (error) throw error;
  return data;
}

async function fetchSharesOutstanding() {
  const { data, error } = await sb.from("shares_outstanding").select("*");
  if (error) throw error;
  const map = {};
  for (const row of data) map[row.ticker] = row;
  return map;
}

// O Supabase limita cada resposta a 1000 linhas por padrao (Max Rows). Em vez de
// depender de mudar essa configuracao no painel, paginamos ate acabar os dados.
async function fetchAllPages(queryFn) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchSeries(ticker) {
  return fetchAllPages((from, to) =>
    sb
      .from("market_data_daily")
      .select("trade_date, price, volume, financial_volume")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: true })
      .range(from, to)
  );
}

async function fetchTreasurySeries(seriesId) {
  const rows = await fetchAllPages((from, to) =>
    sb
      .from("treasury_yields")
      .select("obs_date, value")
      .eq("series_id", seriesId)
      .order("obs_date", { ascending: true })
      .range(from, to)
  );
  // O FRED nao publica valor em feriado/fim de semana do mercado americano (a linha
  // existe no banco, so que com value=null). Em vez de deixar um buraco no grafico,
  // repete o ultimo rendimento conhecido nesses dias.
  let lastKnown = null;
  return rows.map((r) => {
    if (r.value != null) lastKnown = r.value;
    return { trade_date: r.obs_date, price: r.value ?? lastKnown, volume: null, financial_volume: null };
  });
}

// shares_outstanding_history pode nao existir ainda (rode a migration 0004);
// se a tabela faltar, cai de volta pro snapshot fixo em vez de quebrar a pagina.
async function fetchSharesHistory(ticker) {
  try {
    const { data, error } = await sb
      .from("shares_outstanding_history")
      .select("effective_date, shares")
      .eq("ticker", ticker)
      .order("effective_date", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({ trade_date: r.effective_date, price: r.shares }));
  } catch (err) {
    console.warn("[shares_outstanding_history] indisponível (rode a migration 0004?):", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Noticias recentes (Google News RSS, sincronizado 1x/dia - scripts/sync-news.mjs).
// Nao depende do seletor de data: mostra sempre as mais recentes sincronizadas.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mostra as materias publicadas nos NEWS_WINDOW_DAYS antes da data selecionada no
// topo da pagina - mesma logica de "viagem no tempo" do resto do painel. Se nao
// houver nada nesse intervalo (a CASH3 nao sai na midia todo dia), tenta de novo
// com uma janela mais larga (NEWS_WINDOW_FALLBACK_DAYS) antes de mostrar vazio -
// sem avisar qual janela encontrou resultado, so mostra a noticia normalmente.
//
// Se mesmo assim vier vazio, precisamos distinguir dois motivos bem diferentes:
// (a) nao teve noticia relevante mesmo naquele periodo - a sincronizacao ja
//     cobria aquela data, so nao achou nada; ou
// (b) a data selecionada e anterior a quando o sync de noticias comecou a
//     rodar - nesse caso "nao ha noticia" seria enganoso, o correto e dizer que
//     nao temos esse periodo arquivado. Para diferenciar, comparamos a data
//     selecionada com o inserted_at mais antigo salvo (= dia em que o sync
//     rodou pela 1a vez).
//
// news_mentions pode nao existir ainda (rode a migration 0006); se a tabela
// faltar, mostra a secao vazia em vez de quebrar a pagina.
const NEWS_WINDOW_DAYS = 7;
const NEWS_WINDOW_FALLBACK_DAYS = 14;
const NEWS_MAX_ITEMS = 10;

let newsSyncStartDate = null; // YYYY-MM-DD do inserted_at mais antigo em news_mentions; null se tabela vazia/inexistente

async function fetchNewsSyncStartDate() {
  try {
    const { data, error } = await sb.from("news_mentions").select("inserted_at").order("inserted_at", { ascending: true }).limit(1);
    if (error) throw error;
    return data?.[0]?.inserted_at?.slice(0, 10) ?? null;
  } catch (err) {
    return null;
  }
}

async function fetchNewsWindow(dateIso, days, limit = NEWS_MAX_ITEMS) {
  const endDate = new Date(`${dateIso}T23:59:59Z`);
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  const { data, error } = await sb
    .from("news_mentions")
    .select("title, url, source, published_at")
    .gte("published_at", startDate.toISOString())
    .lte("published_at", endDate.toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function fetchNews(dateIso) {
  try {
    const rows = (await fetchNewsWindow(dateIso, NEWS_WINDOW_DAYS)) || [];
    if (rows.length) return rows;
    return await fetchNewsWindow(dateIso, NEWS_WINDOW_FALLBACK_DAYS);
  } catch (err) {
    console.warn("[news_mentions] indisponível (rode a migration 0006?):", err.message);
    return [];
  }
}

function fmtNewsDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(" de ", " ").replace(".", "");
}

function renderNews(rows, dateIso) {
  const el = document.getElementById("news-list");
  if (!el) return;
  if (!rows.length) {
    const dataAnteriorAoSync = newsSyncStartDate && dateIso < newsSyncStartDate;
    el.innerHTML = dataAnteriorAoSync
      ? `<div class="empty-state">Nenhuma notícia salva para essa data — nosso histórico de notícias começou a ser registrado em ${fmtDateBR(newsSyncStartDate)}.</div>`
      : `<div class="empty-state">Sem notícia nos últimos ${NEWS_WINDOW_FALLBACK_DAYS} dias.</div>`;
    return;
  }
  el.innerHTML = rows
    .map(
      (n) => `<div class="news-item">
        <span class="news-tag">${fmtNewsDate(n.published_at)}</span>
        <div class="news-body">
          <a class="news-title" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>
          <span class="news-source">${escapeHtml(n.source)}</span>
        </div>
      </div>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Recorte por data: tudo na tela e uma funcao pura de "ate qual dia olhar"
// ---------------------------------------------------------------------------
function sliceUpTo(series, dateIso) {
  return series.filter((r) => r.trade_date <= dateIso);
}

// Valor vigente numa data: o mais recente registro com trade_date <= dateIso;
// se a data selecionada for anterior a todo o historico, usa o registro mais antigo conhecido.
function valueAsOf(series, dateIso) {
  if (!series || !series.length) return null;
  const sliced = sliceUpTo(series, dateIso);
  if (sliced.length) return sliced[sliced.length - 1].price;
  return series[0].price;
}

// Dia de pregao mais proximo (pra tras) de uma data sem pregao (feriado, fim de semana etc).
function nearestAvailableDate(series, dateIso) {
  if (!series || !series.length) return dateIso;
  const sliced = sliceUpTo(series, dateIso);
  if (sliced.length) return sliced[sliced.length - 1].trade_date;
  return series[0].trade_date;
}

// ---------------------------------------------------------------------------
// Calculos sobre series (mesma serie serve para acoes, indices, cripto, cambio e yields)
// ---------------------------------------------------------------------------
function at(series, offsetFromEnd) {
  const idx = series.length - 1 - offsetFromEnd;
  return idx >= 0 ? series[idx] : null;
}
function pctChange(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return curr / prev - 1;
}
function minMax(series) {
  let minRow = null;
  let maxRow = null;
  for (const r of series) {
    if (r.price == null) continue;
    if (!minRow || r.price < minRow.price) minRow = r;
    if (!maxRow || r.price > maxRow.price) maxRow = r;
  }
  return {
    min: minRow?.price ?? null,
    max: maxRow?.price ?? null,
    minDate: minRow?.trade_date ?? null,
    maxDate: maxRow?.trade_date ?? null,
  };
}
function avgFinancialVolume(series, count, offset = 0) {
  const slice = series.slice(Math.max(0, series.length - offset - count), series.length - offset);
  const vals = slice.map((r) => r.financial_volume).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function computeYtd(series) {
  const last = series[series.length - 1];
  if (!last) return null;
  const currentYear = parseInt(last.trade_date.slice(0, 4), 10);
  let baseline = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const rowYear = parseInt(series[i].trade_date.slice(0, 4), 10);
    if (rowYear < currentYear) {
      baseline = series[i];
      break;
    }
  }
  return baseline ? pctChange(last.price, baseline.price) : null;
}

function computeRow(series) {
  const last = series[series.length - 1] ?? null;
  const monthAgo = at(series, MONTH_LOOKBACK);
  const yearAgo = at(series, YEAR_LOOKBACK);
  // "Preco 12 meses" e uma janela movel, nao o minimo/maximo desde o inicio do historico.
  const last12mWindow = series.slice(-(YEAR_LOOKBACK + 1));
  const { min, max, minDate, maxDate } = minMax(last12mWindow);
  const volAvgMonth = avgFinancialVolume(series, MONTH_LOOKBACK, 0);
  const volAvgPrevMonth = avgFinancialVolume(series, MONTH_LOOKBACK, MONTH_LOOKBACK);
  return {
    date: last?.trade_date ?? null,
    price: last?.price ?? null,
    varMes: pctChange(last?.price, monthAgo?.price),
    ytd: computeYtd(series),
    var12m: pctChange(last?.price, yearAgo?.price),
    min,
    max,
    minDate,
    maxDate,
    volAvgMonth,
    volVarMonth: pctChange(volAvgMonth, volAvgPrevMonth),
  };
}

function pctCell(v) {
  if (v == null) return '<span style="color:var(--ink-faint);">—</span>';
  const cls = v > 0 ? "ba-pos" : v < 0 ? "ba-neg" : "";
  return `<span class="${cls}">${fmtPct(v)}</span>`;
}

// Barra visual "menor valor — •  — maior valor", igual ao mockup original.
// O title (dica ao passar o mouse) mostra em que dia aquele minimo/maximo ocorreu.
function rangeTrackHtml(min, max, curr, formatFn, minDate, maxDate) {
  if (min == null || max == null) {
    return `<td colspan="3" style="text-align:center;color:var(--ink-faint);">—</td>`;
  }
  const pct = max > min ? ((curr - min) / (max - min)) * 100 : 50;
  const clamped = Math.max(0, Math.min(100, pct));
  const minTitle = minDate ? `Registrado em ${fmtDateBR(minDate)}` : "";
  const maxTitle = maxDate ? `Registrado em ${fmtDateBR(maxDate)}` : "";
  return (
    `<td class="num range-endpoint" title="${minTitle}">${formatFn(min)}</td>` +
    `<td class="range-track-cell"><div class="range-track"><span class="range-dot" style="left:${clamped.toFixed(1)}%;"></span></div></td>` +
    `<td class="num range-endpoint" title="${maxTitle}">${formatFn(max)}</td>`
  );
}

// ---------------------------------------------------------------------------
// KPIs do topo (CASH3)
// ---------------------------------------------------------------------------
let cash3Shares = null;

function renderKpis(cash3Sliced, sharesOverride) {
  const curr = cash3Sliced[cash3Sliced.length - 1];
  const prev = cash3Sliced.length > 1 ? cash3Sliced[cash3Sliced.length - 2] : null;
  if (!curr) return;

  const shares = sharesOverride ?? cash3Shares?.shares ?? null;
  const marketCap = shares != null && curr.price != null ? curr.price * shares : cash3Shares?.market_cap_override ?? null;
  const marketCapPrev = prev && shares != null && prev.price != null ? prev.price * shares : null;

  const tiles = [
    {
      label: "Total de acionistas",
      value: "—",
      note: "depende da base de acionistas (ainda nao integrada)",
    },
    {
      label: "Total de ações em circulação",
      value: fmtInt(shares),
      note: shares != null ? "" : "quantidade não disponível na planilha",
    },
    {
      label: `Valor de mercado · ${fmtDateBR(curr.trade_date)}`,
      value: fmtMoneyAuto(marketCap, "BRL"),
      delta: prev ? pctChange(marketCap, marketCapPrev) : null,
    },
    {
      label: "Volume negociado no dia",
      value: fmtMoneyAuto(curr.financial_volume, "BRL"),
      delta: prev ? pctChange(curr.financial_volume, prev.financial_volume) : null,
    },
    {
      label: "Free float",
      value: "—",
      note: "depende do % do grupo controlador (ainda nao integrado)",
    },
  ];

  document.getElementById("kpi-row").innerHTML = tiles
    .map((t) => {
      const deltaHtml =
        t.delta !== undefined && t.delta !== null
          ? `<div class="delta ${deltaClass(t.delta)}">${arrow(t.delta)} ${fmtPct(Math.abs(t.delta))}</div>`
          : t.note
          ? `<div class="delta flat">${t.note}</div>`
          : "";
      return `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div>${deltaHtml}</div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Graficos comparativos (Chart.js) - com tooltip mostrando a cotacao do dia
// ---------------------------------------------------------------------------
const chartInstances = {};

function alignByDate(baseSeries, otherSeries, count) {
  const base = baseSeries.slice(-count);
  const otherByDate = new Map(otherSeries.map((r) => [r.trade_date, r.price]));
  return base.map((r) => ({ date: r.trade_date, base: r.price, other: otherByDate.get(r.trade_date) ?? null }));
}

function renderComparisonChart(canvasId, baseSeries, otherSeries, baseLabel, otherLabel, otherColor, otherFormatFn) {
  const aligned = alignByDate(baseSeries, otherSeries, 30);
  const labels = aligned.map((r) => fmtDateBR(r.date).slice(0, 5));
  const baseFormatFn = (v) => fmtPrice(v, "BRL");

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  chartInstances[canvasId] = new Chart(document.getElementById(canvasId), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: baseLabel, data: aligned.map((r) => r.base), borderColor: "#FF619A", backgroundColor: "transparent", tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5, yAxisID: "y" },
        { label: otherLabel, data: aligned.map((r) => r.other), borderColor: otherColor, backgroundColor: "transparent", tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, yAxisID: "y1" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { position: "left", ticks: { callback: (v) => baseFormatFn(v) } },
        y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => otherFormatFn(v) } },
      },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => (items.length ? `Pregão de ${fmtDateBR(aligned[items[0].dataIndex].date)}` : ""),
            label: (item) => {
              if (item.raw == null) return `${item.dataset.label}: sem dado`;
              const fmt = item.datasetIndex === 0 ? baseFormatFn : otherFormatFn;
              return `${item.dataset.label}: ${fmt(item.raw)}`;
            },
          },
        },
      },
    },
  });
}

// Igual ao renderComparisonChart, mas com duas series "outras" (US 5Y e US 10Y)
// dividindo o mesmo eixo direito, ja que as duas sao em % (nao precisam de eixos separados).
function renderTreasuryComparisonChart(canvasId, baseSeries, dgs5Series, dgs10Series) {
  const base = baseSeries.slice(-30);
  const labels = base.map((r) => fmtDateBR(r.trade_date).slice(0, 5));
  const dgs5ByDate = new Map(dgs5Series.map((r) => [r.trade_date, r.price]));
  const dgs10ByDate = new Map(dgs10Series.map((r) => [r.trade_date, r.price]));
  const baseFormatFn = (v) => fmtPrice(v, "BRL");
  const pctFormatFn = (v) => (v == null ? "—" : v.toFixed(2) + "%");

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  chartInstances[canvasId] = new Chart(document.getElementById(canvasId), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "CASH3", data: base.map((r) => r.price), borderColor: "#FF619A", backgroundColor: "transparent", tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5, yAxisID: "y" },
        { label: "US 5Y", data: base.map((r) => dgs5ByDate.get(r.trade_date) ?? null), borderColor: chartSecondaryColor(), backgroundColor: "transparent", tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, yAxisID: "y1" },
        { label: "US 10Y", data: base.map((r) => dgs10ByDate.get(r.trade_date) ?? null), borderColor: "#E08A3C", backgroundColor: "transparent", tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, yAxisID: "y1" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { position: "left", ticks: { callback: (v) => baseFormatFn(v) } },
        y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => pctFormatFn(v) } },
      },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => (items.length ? `Pregão de ${fmtDateBR(base[items[0].dataIndex].trade_date)}` : ""),
            label: (item) => {
              if (item.raw == null) return `${item.dataset.label}: sem dado`;
              const fmt = item.datasetIndex === 0 ? baseFormatFn : pctFormatFn;
              return `${item.dataset.label}: ${fmt(item.raw)}`;
            },
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tabela de peers
// ---------------------------------------------------------------------------
function renderPeerTable(instruments, slicedSeriesByTicker, sharesByTicker, sharesOverrideByTicker, treasuryRows) {
  const groups = {};
  for (const inst of instruments) {
    if (!groups[inst.category]) groups[inst.category] = [];
    groups[inst.category].push(inst);
  }

  function tickerRowHtml(inst, series, highlight = false) {
    const r = computeRow(series);
    const staticShares = sharesByTicker[inst.ticker];
    const overrideShares = sharesOverrideByTicker[inst.ticker];
    const sharesCount = overrideShares ?? staticShares?.shares ?? null;
    const marketCap =
      overrideShares == null && staticShares?.market_cap_override != null
        ? staticShares.market_cap_override
        : sharesCount != null && r.price != null
        ? r.price * sharesCount
        : null;
    const nameCell = inst.ir_url
      ? `<a class="peer-link" href="${inst.ir_url}" target="_blank" rel="noopener noreferrer" title="Abrir site de RI da ${inst.display_name}">${inst.display_name}</a>`
      : inst.display_name;
    return `<tr${highlight ? ' class="meliuz-row"' : ""}>
      <td>${nameCell}</td>
      <td>${inst.ticker}</td>
      <td class="num">${fmtPrice(r.price, inst.currency)}</td>
      <td class="num">${pctCell(r.varMes)}</td>
      <td class="num">${pctCell(r.ytd)}</td>
      <td class="num">${pctCell(r.var12m)}</td>
      ${rangeTrackHtml(r.min, r.max, r.price, (v) => fmtPrice(v, inst.currency), r.minDate, r.maxDate)}
      <td class="num">${fmtMoneyAuto(r.volAvgMonth, inst.currency)}</td>
      <td class="num">${pctCell(r.volVarMonth)}</td>
      <td class="num">${fmtMoneyAuto(marketCap, inst.currency)}</td>
    </tr>`;
  }

  const order = ["Meliuz", "Tecnologia", "Varejo", "Bitcoin Treasury", "Indices e cambio"];
  let html = "";
  for (const cat of order) {
    if (!groups[cat]) continue;
    html += `<tr class="group-row"><td colspan="12">${cat}</td></tr>`;
    for (const inst of groups[cat]) {
      html += tickerRowHtml(inst, slicedSeriesByTicker[inst.ticker] ?? [], cat === "Meliuz");
    }
  }
  html += `<tr class="group-row"><td colspan="12">Treasury (EUA)</td></tr>`;
  for (const t of treasuryRows) {
    const r = computeRow(t.series);
    const pctFmt = (v) => (v == null ? "—" : v.toFixed(2) + "%");
    html += `<tr>
      <td>${t.label}</td>
      <td>—</td>
      <td class="num">${pctFmt(r.price)}</td>
      <td class="num">${pctCell(r.varMes)}</td>
      <td class="num">${pctCell(r.ytd)}</td>
      <td class="num">${pctCell(r.var12m)}</td>
      ${rangeTrackHtml(r.min, r.max, r.price, pctFmt, r.minDate, r.maxDate)}
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
    </tr>`;
  }

  document.getElementById("peer-table-body").innerHTML = html;
}

// ---------------------------------------------------------------------------
// Boot + navegacao por data (recorta tudo e redesenha a pagina inteira)
// ---------------------------------------------------------------------------
let instruments = [];
let sharesByTicker = {};
let seriesByTicker = {};
let treasurySeriesById = {};
let cash3SharesHistory = [];

function renderForDate(dateIso) {
  const cash3Sliced = sliceUpTo(seriesByTicker["CASH3"] ?? [], dateIso);
  if (!cash3Sliced.length) return;

  const cash3SharesAsOf = valueAsOf(cash3SharesHistory, dateIso);
  renderKpis(cash3Sliced, cash3SharesAsOf);

  const ibovSliced = sliceUpTo(seriesByTicker["IBOV"] ?? [], dateIso);
  const btcSliced = sliceUpTo(seriesByTicker["BTCBRL"] ?? [], dateIso);
  renderComparisonChart("chart-cash3-ibov", cash3Sliced, ibovSliced, "CASH3", "IBOV", chartSecondaryColor(), (v) => Math.round(v).toLocaleString("pt-BR") + " pts");
  renderComparisonChart("chart-cash3-btc", cash3Sliced, btcSliced, "CASH3", "BTC", "#E08A3C", (v) => currencySymbol("BRL") + NBSP + Math.round(v).toLocaleString("pt-BR"));

  const dgs5Sliced = sliceUpTo(treasurySeriesById["DGS5"] ?? [], dateIso);
  const dgs10Sliced = sliceUpTo(treasurySeriesById["DGS10"] ?? [], dateIso);
  renderTreasuryComparisonChart("chart-cash3-treasury", cash3Sliced, dgs5Sliced, dgs10Sliced);

  const slicedSeriesByTicker = {};
  for (const inst of instruments) {
    slicedSeriesByTicker[inst.ticker] = sliceUpTo(seriesByTicker[inst.ticker] ?? [], dateIso);
  }
  const sharesOverrideByTicker = cash3SharesAsOf != null ? { CASH3: cash3SharesAsOf } : {};
  renderPeerTable(instruments, slicedSeriesByTicker, sharesByTicker, sharesOverrideByTicker, [
    { label: "US Treasury 5Y (%)", series: sliceUpTo(treasurySeriesById["DGS5"] ?? [], dateIso) },
    { label: "US Treasury 10Y (%)", series: sliceUpTo(treasurySeriesById["DGS10"] ?? [], dateIso) },
  ]);

  fetchNews(dateIso).then((rows) => renderNews(rows, dateIso));
}

async function boot() {
  try {
    [instruments, sharesByTicker] = await Promise.all([fetchInstruments(), fetchSharesOutstanding()]);
    newsSyncStartDate = await fetchNewsSyncStartDate();

    seriesByTicker = {};
    await Promise.all(
      instruments.map(async (inst) => {
        seriesByTicker[inst.ticker] = await fetchSeries(inst.ticker);
      })
    );

    cash3SharesHistory = await fetchSharesHistory("CASH3");

    const [dgs5, dgs10] = await Promise.all([fetchTreasurySeries("DGS5"), fetchTreasurySeries("DGS10")]);
    treasurySeriesById = { DGS5: dgs5, DGS10: dgs10 };

    const cash3Series = seriesByTicker["CASH3"] ?? [];
    cash3Shares = sharesByTicker["CASH3"] ?? null;

    if (!cash3Series.length) {
      document.getElementById("visao-geral-root").innerHTML =
        '<div class="empty-state">Ainda não há dados sincronizados no Supabase. Rode o workflow "Sync market data" no GitHub Actions (aba Actions → Run workflow) e recarregue esta página.</div>';
      return;
    }

    const cash3TradeDateSet = new Set(cash3Series.map((r) => r.trade_date));

    const dateSelect = document.getElementById("kpi-date-select");
    const dateNotice = document.getElementById("date-notice");
    const earliestDate = cash3Series[0].trade_date;
    const latestDate = cash3Series[cash3Series.length - 1].trade_date;
    dateSelect.min = earliestDate;
    dateSelect.max = latestDate;
    dateSelect.value = latestDate;
    dateSelect.addEventListener("change", () => {
      // se o usuario digitar/colar uma data fora do intervalo com dados, volta pro limite mais proximo
      if (dateSelect.value < earliestDate) dateSelect.value = earliestDate;
      if (dateSelect.value > latestDate) dateSelect.value = latestDate;

      const requested = dateSelect.value;
      const snapped = cash3TradeDateSet.has(requested) ? requested : nearestAvailableDate(cash3Series, requested);
      if (snapped !== requested) {
        dateSelect.value = snapped;
        dateNotice.textContent = `Sem pregão em ${fmtDateBR(requested)} — mostrando dados de ${fmtDateBR(snapped)}.`;
        dateNotice.style.display = "block";
      } else {
        dateNotice.style.display = "none";
      }

      renderForDate(dateSelect.value);
    });

    renderForDate(latestDate);
  } catch (err) {
    console.error(err);
    document.getElementById("visao-geral-root").innerHTML =
      `<div class="empty-state">Erro ao carregar dados do Supabase: ${err.message}. Confira docs/js/config.js e as políticas de RLS.</div>`;
  }
}

boot();
