// Radar RI - Painel CASH3 > Visao Geral
// Le tudo do Supabase (populado pelo GitHub Actions a partir da planilha + FRED).
// Nao ha nenhum dado mockado aqui: onde a informacao ainda nao existe (base de
// acionistas, free float), a tela mostra um traco em vez de inventar um numero.

const MONTH_LOOKBACK = 21;  // ~1 mes de pregoes
const YEAR_LOOKBACK = 252;  // ~12 meses de pregoes
const HISTORY_LIMIT = 280;  // pregoes buscados por ticker (~13 meses)

const cfg = window.RADAR_RI_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------
function currencySymbol(currency) {
  return currency === "USD" ? "US$ " : currency === "EUR" ? "€ " : "R$ ";
}
function fmtPrice(value, currency) {
  if (value == null || !isFinite(value)) return "—";
  return currencySymbol(currency) + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (Math.abs(value) >= 1e9) return symbol + (value / 1e9).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " bi";
  return symbol + (value / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mi";
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
// Acesso a dados
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

async function fetchSeries(ticker) {
  const { data, error } = await sb
    .from("market_data_daily")
    .select("trade_date, price, volume, financial_volume")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return data.slice().reverse(); // ordem crescente (mais antigo -> mais recente)
}

async function fetchTreasurySeries(seriesId) {
  const { data, error } = await sb
    .from("treasury_yields")
    .select("obs_date, value")
    .eq("series_id", seriesId)
    .order("obs_date", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return data.slice().reverse().map((r) => ({ trade_date: r.obs_date, price: r.value, volume: null, financial_volume: null }));
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
  const prices = series.map((r) => r.price).filter((p) => p != null);
  if (!prices.length) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
function avgFinancialVolume(series, count, offset = 0) {
  const slice = series.slice(Math.max(0, series.length - offset - count), series.length - offset);
  const vals = slice.map((r) => r.financial_volume).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function computeRow(series) {
  const last = series[series.length - 1] ?? null;
  const monthAgo = at(series, MONTH_LOOKBACK);
  const yearAgo = at(series, YEAR_LOOKBACK);
  const { min, max } = minMax(series);
  const volAvgMonth = avgFinancialVolume(series, MONTH_LOOKBACK, 0);
  const volAvgPrevMonth = avgFinancialVolume(series, MONTH_LOOKBACK, MONTH_LOOKBACK);
  return {
    date: last?.trade_date ?? null,
    price: last?.price ?? null,
    varMes: pctChange(last?.price, monthAgo?.price),
    var12m: pctChange(last?.price, yearAgo?.price),
    min,
    max,
    volAvgMonth,
    volVarMonth: pctChange(volAvgMonth, volAvgPrevMonth),
  };
}

// ---------------------------------------------------------------------------
// KPIs do topo (CASH3)
// ---------------------------------------------------------------------------
let cash3Series = [];
let cash3Shares = null;

function renderKpis(dateIso) {
  const idx = cash3Series.findIndex((r) => r.trade_date === dateIso);
  if (idx === -1) return;
  const curr = cash3Series[idx];
  const prev = idx > 0 ? cash3Series[idx - 1] : null;

  const shares = cash3Shares?.shares ?? null;
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
// Graficos comparativos (Chart.js)
// ---------------------------------------------------------------------------
function alignByDate(baseSeries, otherSeries, count) {
  const base = baseSeries.slice(-count);
  const otherByDate = new Map(otherSeries.map((r) => [r.trade_date, r.price]));
  return base.map((r) => ({ date: r.trade_date, base: r.price, other: otherByDate.get(r.trade_date) ?? null }));
}

function renderComparisonChart(canvasId, baseSeries, otherSeries, baseLabel, otherLabel, otherColor) {
  const aligned = alignByDate(baseSeries, otherSeries, 30);
  const labels = aligned.map((r) => fmtDateBR(r.date).slice(0, 5));
  new Chart(document.getElementById(canvasId), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: baseLabel, data: aligned.map((r) => r.base), borderColor: "#FF619A", backgroundColor: "transparent", tension: 0.4, pointRadius: 0, borderWidth: 2.5, yAxisID: "y" },
        { label: otherLabel, data: aligned.map((r) => r.other), borderColor: otherColor, backgroundColor: "transparent", tension: 0.4, pointRadius: 0, borderWidth: 2, yAxisID: "y1" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { position: "left", ticks: { callback: (v) => "R$ " + v.toFixed(2).replace(".", ",") } },
        y1: { position: "right", grid: { display: false } },
      },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
    },
  });
}

// ---------------------------------------------------------------------------
// Tabela de peers
// ---------------------------------------------------------------------------
function renderPeerTable(instruments, seriesByTicker, sharesByTicker, treasuryRows) {
  const groups = {};
  for (const inst of instruments) {
    if (!groups[inst.category]) groups[inst.category] = [];
    groups[inst.category].push(inst);
  }

  function tickerRowHtml(inst, series, highlight = false) {
    const r = computeRow(series);
    const shares = sharesByTicker[inst.ticker];
    const marketCap =
      shares?.market_cap_override != null
        ? shares.market_cap_override
        : shares?.shares != null && r.price != null
        ? r.price * shares.shares
        : null;
    return `<tr${highlight ? ' class="meliuz-row"' : ""}>
      <td>${inst.display_name}</td>
      <td>${inst.ticker}</td>
      <td class="num">${fmtPrice(r.price, inst.currency)}</td>
      <td class="num">${pctCell(r.varMes)}</td>
      <td class="num">${pctCell(r.var12m)}</td>
      <td class="num">${fmtPrice(r.min, inst.currency)}</td>
      <td class="num">${fmtPrice(r.max, inst.currency)}</td>
      <td class="num">${fmtMoneyAuto(r.volAvgMonth, inst.currency)}</td>
      <td class="num">${pctCell(r.volVarMonth)}</td>
      <td class="num">${fmtMoneyAuto(marketCap, inst.currency)}</td>
    </tr>`;
  }

  function pctCell(v) {
    if (v == null) return '<span style="color:var(--ink-faint);">—</span>';
    const cls = v > 0 ? "ba-pos" : v < 0 ? "ba-neg" : "";
    return `<span class="${cls}">${fmtPct(v)}</span>`;
  }

  const order = ["Meliuz", "Tecnologia", "Varejo", "Bitcoin Treasury", "Indices e cambio"];
  let html = "";
  for (const cat of order) {
    if (!groups[cat]) continue;
    html += `<tr class="group-row"><td colspan="10">${cat}</td></tr>`;
    for (const inst of groups[cat]) {
      html += tickerRowHtml(inst, seriesByTicker[inst.ticker] ?? [], cat === "Meliuz");
    }
  }
  html += `<tr class="group-row"><td colspan="10">Treasury (EUA)</td></tr>`;
  for (const t of treasuryRows) {
    const r = computeRow(t.series);
    html += `<tr>
      <td>${t.label}</td>
      <td>—</td>
      <td class="num">${r.price != null ? r.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) + "%" : "—"}</td>
      <td class="num">${pctCell(r.varMes)}</td>
      <td class="num">${pctCell(r.var12m)}</td>
      <td class="num">${r.min != null ? r.min.toFixed(2) + "%" : "—"}</td>
      <td class="num">${r.max != null ? r.max.toFixed(2) + "%" : "—"}</td>
      <td class="num">—</td>
      <td class="num">—</td>
      <td class="num">—</td>
    </tr>`;
  }

  document.getElementById("peer-table-body").innerHTML = html;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    const [instruments, sharesByTicker] = await Promise.all([fetchInstruments(), fetchSharesOutstanding()]);

    const seriesByTicker = {};
    await Promise.all(instruments.map(async (inst) => {
      seriesByTicker[inst.ticker] = await fetchSeries(inst.ticker);
    }));

    const [dgs5, dgs10] = await Promise.all([fetchTreasurySeries("DGS5"), fetchTreasurySeries("DGS10")]);

    cash3Series = seriesByTicker["CASH3"] ?? [];
    cash3Shares = sharesByTicker["CASH3"] ?? null;

    if (!cash3Series.length) {
      document.getElementById("visao-geral-root").innerHTML =
        '<div class="empty-state">Ainda não há dados sincronizados no Supabase. Rode o workflow "Sync market data" no GitHub Actions (aba Actions → Run workflow) e recarregue esta página.</div>';
      return;
    }

    // seletor de data
    const dateSelect = document.getElementById("kpi-date-select");
    dateSelect.innerHTML = cash3Series
      .slice()
      .reverse()
      .map((r) => `<option value="${r.trade_date}">${fmtDateBR(r.trade_date)}</option>`)
      .join("");
    const latestDate = cash3Series[cash3Series.length - 1].trade_date;
    dateSelect.value = latestDate;
    dateSelect.addEventListener("change", () => renderKpis(dateSelect.value));
    renderKpis(latestDate);

    renderComparisonChart("chart-cash3-ibov", cash3Series, seriesByTicker["IBOV"] ?? [], "CASH3", "IBOV", "#2A2A2A");
    renderComparisonChart("chart-cash3-btc", cash3Series, seriesByTicker["BTCBRL"] ?? [], "CASH3", "BTC", "#E08A3C");

    renderPeerTable(
      instruments,
      seriesByTicker,
      sharesByTicker,
      [
        { label: "US Treasury 5Y (%)", series: dgs5 },
        { label: "US Treasury 10Y (%)", series: dgs10 },
      ]
    );
  } catch (err) {
    console.error(err);
    document.getElementById("visao-geral-root").innerHTML =
      `<div class="empty-state">Erro ao carregar dados do Supabase: ${err.message}. Confira public/js/config.js e as políticas de RLS.</div>`;
  }
}

boot();
