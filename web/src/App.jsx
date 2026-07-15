import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Home } from 'lucide-react';
import { CalendarDays, Download, FileSpreadsheet, ImageDown, X } from 'lucide-react';
import html2canvas from 'html2canvas';
import {
  applyMetaFilters,
  applyFilters,
  buildDailyTable,
  buildDailyTrend,
  buildMonthly,
  buildMonthlyByUmb,
  buildProjection,
  totals,
  uniqueValues
} from './lib/aggregate.js';
import { formatDate, formatKg, formatMil, monthNames } from './lib/format.js';

const DEFAULT_SOURCE = 'https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit?usp=sharing&ouid=10613097494102742878&rtpof=true&sd=true';
const DEFAULT_REFRESH_SECONDS = 300;

function normalizeRefreshMs(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_REFRESH_SECONDS * 1000;
  return Math.min(Math.max(Math.round(seconds), DEFAULT_REFRESH_SECONDS), 24 * 60 * 60) * 1000;
}

async function fetchDashboardPayload() {
  const liveUrl = import.meta.env.VITE_DASHBOARD_API_URL || '';
  const staticUrl = getStaticCacheUrl();
  const errors = [];

  for (const candidate of [liveUrl, staticUrl].filter(Boolean)) {
    try {
      const payload = await fetchJson(candidate);
      return normalizeDashboardPayload(payload, candidate === liveUrl ? 'function' : 'static-cache');
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(errors.join(' | ') || 'Nenhuma fonte de dashboard configurada.');
}

function getStaticCacheUrl() {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}dashboard-cache.json`;
}

async function fetchJson(url) {
  const response = await fetch(withCacheBuster(url), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function withCacheBuster(url) {
  const separator = String(url).includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
}

function normalizeDashboardPayload(payload, sourceKind) {
  const rawCache = payload?.cache && typeof payload.cache === 'object' ? payload.cache : payload;
  if (!rawCache || typeof rawCache !== 'object') {
    throw new Error('Resposta sem objeto de cache.');
  }

  const records = Array.isArray(rawCache.records) ? rawCache.records : [];
  const config = payload?.config && typeof payload.config === 'object' ? payload.config : {};
  const sourceUrl = config.sourceUrl || rawCache.sourceUrl || rawCache.source || payload?.sourceUrl || payload?.source || DEFAULT_SOURCE;
  const refreshSeconds = payload?.refreshSeconds || config.refreshSeconds || rawCache.refreshSeconds || DEFAULT_REFRESH_SECONDS;

  return {
    cache: { ...rawCache, records, sourceKind },
    status: payload?.status || null,
    updatedAt: payload?.updatedAt || rawCache.updatedAt || payload?.status?.lastSuccessAt || null,
    config: {
      sourceUrl,
      alertEmail: config.alertEmail,
      refreshSeconds
    }
  };
}

function getCurrentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const pad = (v) => String(v).padStart(2, '0');
  const start = `${year}-${month}-01`;
  const lastDay = new Date(year, now.getMonth() + 1, 0);
  const end = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;
  return { start, end };
}

function App() {
  const [route, setRoute] = useState(() => window.location.hash || '#/');
  const [cache, setCache] = useState({ records: [] });
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState({
    sourceUrl: DEFAULT_SOURCE,
    alertEmail: 'thiago.ferreira@enaex.com',
    refreshSeconds: DEFAULT_REFRESH_SECONDS
  });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;
    const pollIntervalMs = normalizeRefreshMs(config?.refreshSeconds);

    async function loadDashboard() {
      try {
        const payload = await fetchDashboardPayload();
        if (cancelled) return;
        setCache(payload.cache);
        setStatus(payload.status || { state: 'ok', lastSuccessAt: payload.updatedAt || new Date().toISOString() });
        setConfig((old) => ({
          ...old,
          sourceUrl: payload.config?.sourceUrl || old.sourceUrl || DEFAULT_SOURCE,
          alertEmail: payload.config?.alertEmail || old.alertEmail,
          refreshSeconds: payload.config?.refreshSeconds || old.refreshSeconds || DEFAULT_REFRESH_SECONDS
        }));
        setOnline(true);
      } catch (error) {
        if (!cancelled) {
          setOnline(false);
          setStatus({ state: 'error', lastError: error.message });
        }
      } finally {
        if (!cancelled) timerId = window.setTimeout(loadDashboard, pollIntervalMs);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [config?.refreshSeconds]);

  return (
    <div className="appShell">
      <Topbar />
      <Sidebar route={route} online={online} />
      <main className="mainCanvas">
        <Dashboard cache={cache} status={status} config={config} />
      </main>
    </div>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="brand">
        <img src="assets/Enaex Brasil - White.png" alt="Enaex Brasil" />
      </div>
      <h1>Emulsão</h1>
      <span className="topbarUnit">US VALE VERDE</span>
    </header>
  );
}

function Sidebar({ route, online }) {
  return (
    <aside className="sidebar">
      <a className={route === '#/' ? 'active' : ''} href="#/" title="Dashboard"><Home size={23} /></a>
      <span className={`connectionDot ${online ? 'isOnline' : 'isOffline'}`} title={online ? 'Cache online' : 'Falha ao ler cache'} />
    </aside>
  );
}

function getDateTicks(rows) {
  if (rows.length <= 6) return rows.map((item) => item.dia);
  const lastIndex = rows.length - 1;
  const indexes = new Set([0, lastIndex]);
  for (let i = 1; i <= 4; i += 1) {
    indexes.add(Math.round((i * lastIndex) / 5));
  }
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((idx) => rows[idx]?.dia)
    .filter(Boolean);
}

function Dashboard({ cache, status, config }) {
  const allRecords = cache?.records || [];
  const metas = cache?.metas || [];

  const currentMonth = useMemo(() => getCurrentMonthRange(), []);

  const [filters, setFilters] = useState(() => ({
    poligonoSearch: '',
    poligono: 'Todos',
    umb: 'Todos',
    operador: 'Todos',
    year: 'Todos',
    month: 'Todos',
    startDate: getCurrentMonthRange().start,
    endDate: getCurrentMonthRange().end
  }));
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDate, setReportDate] = useState('');

  const dateRange = useMemo(() => {
    const dates = allRecords.map((r) => r.data).filter(Boolean).sort();
    return {
      start: dates[0] || '2026-01-01',
      end: dates[dates.length - 1] || '2026-12-31'
    };
  }, [allRecords]);

  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      poligonoSearch: '',
      poligono: 'Todos',
      umb: 'Todos',
      operador: 'Todos',
      year: 'Todos',
      month: 'Todos',
      startDate: dateRange.start,
      endDate: dateRange.end
    });
  }, [dateRange.start, dateRange.end]);

  const filteredRecords = useMemo(() => applyFilters(allRecords, filters), [allRecords, filters]);
  const filteredMetas = useMemo(() => applyMetaFilters(metas, filters), [metas, filters]);

  const dailyRows = useMemo(() => buildDailyTable(filteredRecords), [filteredRecords]);
  const dailyTrend = useMemo(() => buildDailyTrend(filteredRecords, filteredMetas), [filteredRecords, filteredMetas]);
  const dailyTicks = useMemo(() => getDateTicks(dailyTrend), [dailyTrend]);
  const latestApplication = dailyTrend.length ? dailyTrend[dailyTrend.length - 1].data : '';
  const monthly = useMemo(() => buildMonthly(filteredRecords), [filteredRecords]);
  const monthlyByUmb = useMemo(() => buildMonthlyByUmb(filteredRecords), [filteredRecords]);
  const projection = useMemo(() => buildProjection(filteredRecords, cache?.ritmo || []), [filteredRecords, cache?.ritmo]);
  const total = useMemo(() => totals(filteredRecords), [filteredRecords]);
  const latestRecordDate = useMemo(() => allRecords.map((record) => String(record.data || '').slice(0, 10)).filter(Boolean).sort().at(-1) || '', [allRecords]);

  const reportDateBounds = useMemo(() => ({
    start: dateRange.start,
    end: dateRange.end
  }), [dateRange.start, dateRange.end]);

  const openReport = useCallback(() => {
    setReportDate(latestRecordDate || dateRange.end);
    setReportOpen(true);
  }, [dateRange.end, latestRecordDate]);

  const options = useMemo(() => ({
    poligonos: uniqueValues(allRecords, 'poligono'),
    umbs: uniqueValues(allRecords, 'umb'),
    operadores: uniqueValues(allRecords, 'operador'),
    years: Array.from(new Set(allRecords.map((r) => String(r.data || '').slice(0, 4)).filter(Boolean))).sort()
  }), [allRecords]);

  return (
    <div className="dashboardGrid">
      <section className="leftPanel">
        <DailyPanel rows={dailyRows} total={total} />
        <FilterPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          onClear={handleClearFilters}
          options={options}
          dateRange={dateRange}
        />
      </section>
      <section className="rightPanel">
        <StatusStrip cache={cache} status={status} config={config} total={total} latestApplication={latestApplication} onOpenReport={openReport} />

        <ChartCard title="EMULSÃO: Aplicação Dia a Dia" className="chartDailyTrend">
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={dailyTrend} margin={{ top: 10, right: 22, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="dailyEmulsaoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e30613" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="#e30613" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="1 5" vertical={false} />
              <XAxis dataKey="dia" ticks={dailyTicks} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={8} />
              <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => formatKg(v)}
                    labelFormatter={(_, items) => items?.[0]?.payload ? `Data: ${formatDate(items[0].payload.data)}` : ''}
                  />
                }
              />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="aplicado" fill="url(#dailyEmulsaoFill)" stroke="none" legendType="none" />
              <Line type="monotone" dataKey="aplicado" name="Aplicado" stroke="#e30613" strokeWidth={2.6} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="mediaMovel" name="Media movel 7d" stroke="#00A79D" strokeWidth={2.4} dot={false} activeDot={{ r: 4, fill: '#00A79D' }} />
              <Line type="monotone" dataKey="meta" name="Meta" stroke="#B8A53D" strokeWidth={2.2} strokeDasharray="7 5" dot={false} activeDot={{ r: 4, fill: '#B8A53D' }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="EMULSÃO: Aplicação Mensal" className="chartLarge">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={monthly} margin={{ top: 10, right: 22, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="emulsaoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#b00020" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#b00020" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="1 5" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => formatKg(v)}
                    labelFormatter={(label) => `Mes: ${label}`}
                  />
                }
              />
              <Area dataKey="aplicado" fill="url(#emulsaoFill)" stroke="none" legendType="none" />
              <Line type="monotone" dataKey="aplicado" stroke="#9b0016" strokeWidth={3} dot={{ r: 4, fill: '#9b0016' }} activeDot={{ r: 6 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="EMULSÃO: Aplicação Mensal/UMB" className="chartMedium">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={monthlyByUmb} margin={{ top: 12, right: 20, bottom: 12, left: 0 }}>
              <CartesianGrid strokeDasharray="1 5" vertical={false} />
              <XAxis dataKey="umb" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => formatKg(v)}
                    labelFormatter={(_, items) => items?.[0]?.payload ? `${items[0].payload.mes} | UMB ${items[0].payload.umb}` : ''}
                  />
                }
              />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="aplicado" name="Aplicado" fill="#e30613" radius={[2, 2, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="PROJEÇÃO: Aplicação Mensal de Emulsão" className="chartProjection">
          <div className="projectionHeader">
            <span>Legenda:</span>
            <span className="dot dark" /> Ritmo
            <span className="dot red" /> Aplicado
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart layout="vertical" data={projection} margin={{ top: 10, right: 58, bottom: 10, left: 12 }}>
              <CartesianGrid strokeDasharray="1 5" horizontal={false} />
              <XAxis type="number" tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => formatKg(v)} />} />
              <Bar dataKey="value" radius={[0, 2, 2, 0]} fill="#b00020" barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>
      {reportOpen ? (
        <ReportModal
          allRecords={allRecords}
          filters={filters}
          date={reportDate}
          dateBounds={reportDateBounds}
          onDateChange={setReportDate}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}

function getWorkbookDownloadUrl(sourceUrl) {
  const fallback = DEFAULT_SOURCE;
  try {
    const url = new URL(sourceUrl || fallback);
    const sheetsMatch = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (url.hostname.includes('docs.google.com') && sheetsMatch) {
      return `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/export?format=xlsx`;
    }

    const driveMatch = url.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (url.hostname.includes('drive.google.com') && driveMatch) {
      return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
    }

    return url.toString();
  } catch {
    return fallback;
  }
}

function StatusStrip({ cache, status, config, total, latestApplication, onOpenReport }) {
  const failed = status?.state === 'error';
  const workbookDownloadUrl = getWorkbookDownloadUrl(config?.sourceUrl);
  return (
    <div className={`statusStrip ${failed ? 'hasError' : ''}`}>
      <div>
        <span className="label">Registros filtrados</span>
        <strong>{total.registros.toLocaleString('pt-BR')}</strong>
      </div>
      <div>
        <span className="label">Ultima aplicacao</span>
        <strong>{formatDate(latestApplication) || '-'}</strong>
      </div>
      <div>
        <span className="label">Ultima atualizacao</span>
        <strong>{readTimestamp(cache?.updatedAt) || readTimestamp(status?.lastSuccessAt) || 'Aguardando refresh'}</strong>
      </div>
      <div>
        <span className="label">Ciclo automatico</span>
        <strong>{Math.round((config?.refreshSeconds || DEFAULT_REFRESH_SECONDS) / 60)} min</strong>
      </div>
      <button className="reportButton" onClick={onOpenReport} type="button">
        <ImageDown size={16} />
        Exportar relatório
      </button>
      <a
        className="dataButton"
        href={workbookDownloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        download="base-dados-emulsao.xlsx"
        aria-label="Baixar Base de Dados em Excel"
      >
        <FileSpreadsheet size={16} />
        Baixar Base de Dados
      </a>
    </div>
  );
}

function ReportModal({ allRecords, filters, date, dateBounds, onDateChange, onClose }) {
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const selectedDate = String(date || '').slice(0, 10);
  const monthStart = selectedDate ? `${selectedDate.slice(0, 7)}-01` : '';
  const baseFilters = { ...filters, startDate: monthStart, endDate: selectedDate };
  const dayFilters = { ...filters, startDate: selectedDate, endDate: selectedDate };
  const monthRecords = applyFilters(allRecords, baseFilters);
  const dayRecords = applyFilters(allRecords, dayFilters);
  const monthTotal = totals(monthRecords);
  const dayTotal = totals(dayRecords);
  const dayByPolygon = buildDailyTable(dayRecords);
  const monthName = selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '-';

  const exportImage = async () => {
    if (!reportRef.current || !selectedDate) return;
    setExporting(true);
    try {
      const FULL_HD_WIDTH = 1920;
      const FULL_HD_HEIGHT = 1080;
      const previewBounds = reportRef.current.getBoundingClientRect();
      const previewCanvas = await html2canvas(reportRef.current, {
        backgroundColor: '#f7f8f9',
        scale: Math.max(2, FULL_HD_WIDTH / previewBounds.width),
        useCORS: true,
        logging: false
      });
      const canvas = document.createElement('canvas');
      canvas.width = FULL_HD_WIDTH;
      canvas.height = FULL_HD_HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f7f8f9';
      context.fillRect(0, 0, FULL_HD_WIDTH, FULL_HD_HEIGHT);
      const fitScale = Math.max(FULL_HD_WIDTH / previewCanvas.width, FULL_HD_HEIGHT / previewCanvas.height);
      const drawWidth = previewCanvas.width * fitScale;
      const drawHeight = previewCanvas.height * fitScale;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(previewCanvas, (FULL_HD_WIDTH - drawWidth) / 2, (FULL_HD_HEIGHT - drawHeight) / 2, drawWidth, drawHeight);
      const link = document.createElement('a');
      link.download = `relatorio-emulsao-${selectedDate}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="reportOverlay" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="reportDialog">
        <div className="reportDialogHeader">
          <div>
            <span className="eyebrow">Exportação rápida</span>
            <h2 id="report-title">Relatório One Page</h2>
            <p>Escolha a data de referência para consolidar o mês até aquele dia.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Fechar relatório"><X size={20} /></button>
        </div>
        <label className="reportDateField">
          <span><CalendarDays size={16} /> Data da aplicação</span>
          <input type="date" value={selectedDate} min={dateBounds.start} max={dateBounds.end} onChange={(event) => onDateChange(event.target.value)} />
        </label>
        <div className="reportPreview" ref={reportRef}>
          <div className="reportBrandLine"><img className="reportLogo" src="./assets/Enaex Brasil.png" alt="Enaex Brasil" /><span>US VALE VERDE · APLICAÇÃO DE EMULSÃO</span></div>
          <div className="reportHeading">
            <div><span className="reportKicker">Resumo operacional</span><h3>Aplicação de Emulsão</h3><p>{monthName}</p></div>
            <div className="reportDateBadge"><span>Data de referência</span><strong>{formatDate(selectedDate) || '-'}</strong></div>
          </div>
          <div className="reportKpis">
            <ReportKpi label="Aplicado (Month to date)" value={formatKg(monthTotal.emulsao)} tone="red" />
            <ReportKpi label="Aplicado/Dia" value={formatKg(dayTotal.emulsao)} tone="gray" />
            <ReportKpi label="Furos Carregados/Dia" value={dayTotal.furos.toLocaleString('pt-BR')} tone="dark" />
          </div>
          <div className="reportDetailGrid">
            <div><span className="reportSectionLabel">Acumulado mensal</span><strong>{monthTotal.registros.toLocaleString('pt-BR')} registros</strong><small>De {formatDate(monthStart)} até {formatDate(selectedDate)}</small></div>
            <div><span className="reportSectionLabel">Aplicação Detalhada/Dia</span>{dayByPolygon.length ? dayByPolygon.map((row) => <p key={`${row.data}-${row.poligono}`}><span>{row.poligono || 'Sem polígono'}</span><strong>{formatKg(row.emulsao)}</strong></p>) : <small>Nenhuma aplicação encontrada nesta data.</small>}</div>
          </div>
          <div className="reportFooter">Gerado em {new Date().toLocaleString('pt-BR')} · Dados conforme o dashboard</div>
        </div>
        <div className="reportActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button>
          <button className="primaryButton" type="button" onClick={exportImage} disabled={!selectedDate || exporting}><Download size={17} /> {exporting ? 'Gerando imagem...' : 'Baixar imagem PNG'}</button>
        </div>
      </div>
    </div>
  );
}

function ReportKpi({ label, value, tone }) {
  return <div className={`reportKpi ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function DailyPanel({ rows, total }) {
  return (
    <div className="panel dailyPanel">
      <div className="tableHeader">
        <h2>DEMONSTRATIVO DIARIO</h2>
        <span className="tableMeta">{rows.length.toLocaleString('pt-BR')} linhas</span>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Poligono</th>
              <th>Soma de Emulsao</th>
              <th>Soma de Furos</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="tableEmptyState" colSpan="4">Nenhum registro encontrado para os filtros selecionados.</td>
              </tr>
            ) : (
              rows.slice(0, 18).map((row) => (
                <tr key={`${row.data}-${row.poligono}`}>
                  <td>{formatDate(row.data)}</td>
                  <td>{row.poligono}</td>
                  <td>{row.emulsao.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                  <td>{row.furos.toLocaleString('pt-BR')}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="2">Total:</td>
              <td>{total.emulsao.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
              <td>{total.furos.toLocaleString('pt-BR')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function FilterPanel({ filters, onFilterChange, onClear, options, dateRange }) {
  const hasActiveFilter = filters.poligono !== 'Todos' || filters.umb !== 'Todos' || filters.operador !== 'Todos' || filters.year !== 'Todos' || filters.month !== 'Todos' || filters.poligonoSearch !== '';

  const handlePoligonoSearch = useCallback((e) => {
    onFilterChange('poligonoSearch', e.target.value);
  }, [onFilterChange]);

  const handlePoligono = useCallback((e) => {
    onFilterChange('poligono', e.target.value);
  }, [onFilterChange]);

  const handleYear = useCallback((e) => {
    onFilterChange('year', e.target.value);
  }, [onFilterChange]);

  const handleMonth = useCallback((e) => {
    onFilterChange('month', e.target.value);
  }, [onFilterChange]);

  const handleUmb = useCallback((e) => {
    onFilterChange('umb', e.target.value);
  }, [onFilterChange]);

  const handleOperador = useCallback((e) => {
    onFilterChange('operador', e.target.value);
  }, [onFilterChange]);

  const handleStartDate = useCallback((e) => {
    onFilterChange('startDate', e.target.value);
  }, [onFilterChange]);

  const handleEndDate = useCallback((e) => {
    onFilterChange('endDate', e.target.value);
  }, [onFilterChange]);

  return (
    <div className="filtersGrid">
      <div className="panel filterBox span2">
        <h3>POLIGONO</h3>
        <input
          type="text"
          value={filters.poligonoSearch}
          onChange={handlePoligonoSearch}
          placeholder="Search"
        />
        <select value={filters.poligono} onChange={handlePoligono}>
          <option value="Todos">Todos</option>
          {options.poligonos.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>ANO</h3>
        <select value={filters.year} onChange={handleYear}>
          <option value="Todos">Todos</option>
          {options.years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>MES</h3>
        <select value={filters.month} onChange={handleMonth}>
          <option value="Todos">Todos</option>
          {monthNames.map((month, index) => <option value={String(index + 1)} key={month}>{month}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>UMB</h3>
        <select value={filters.umb} onChange={handleUmb}>
          <option value="Todos">Todos</option>
          {options.umbs.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>OPERADOR</h3>
        <select value={filters.operador} onChange={handleOperador}>
          <option value="Todos">Todos</option>
          {options.operadores.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox span2">
        <h3>PERIODO</h3>
        <div className="dateRow">
          <input
            type="date"
            value={filters.startDate || dateRange.start}
            min={dateRange.start}
            max={dateRange.end}
            onChange={handleStartDate}
            title="Filtrar data inicial."
          />
          <input
            type="date"
            value={filters.endDate || dateRange.end}
            min={dateRange.start}
            max={dateRange.end}
            onChange={handleEndDate}
            title="Filtrar data final."
          />
        </div>
        <p className="filterHint">Filtros de data e ano/mes funcionam juntos.</p>
      </div>
      <div className="panel filterBox span2" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button className="clearButton" onClick={onClear} disabled={!hasActiveFilter}>Limpar filtros</button>
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`panel chartCard ${className}`}>
      <div className="chartTitle">{title}</div>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;

  const uniqueMap = new Map();
  for (const item of payload) {
    const key = item?.dataKey ?? item?.name ?? JSON.stringify(item?.value);
    const current = uniqueMap.get(key);
    if (!current) {
      uniqueMap.set(key, item);
      continue;
    }
    const currentName = String(current?.name || '').trim();
    const nextName = String(item?.name || '').trim();
    const currentGeneric = !currentName || currentName === String(current?.dataKey ?? '').trim();
    const nextGeneric = !nextName || nextName === String(item?.dataKey ?? '').trim();
    if (currentGeneric && !nextGeneric) {
      uniqueMap.set(key, item);
    }
  }
  const uniqueItems = Array.from(uniqueMap.values());

  const labelText = typeof labelFormatter === 'function'
    ? labelFormatter(label, uniqueItems)
    : (typeof label === 'string' ? label : uniqueItems[0]?.payload?.name || '');

  return (
    <div className="chartTooltip">
      {labelText ? <div className="chartTooltipLabel">{labelText}</div> : null}
      <div className="chartTooltipItems">
        {uniqueItems.map((item) => {
          const color = item?.color || item?.stroke || item?.fill || '#8a0015';
          const name = item?.name || item?.dataKey || 'Valor';
          const value = typeof valueFormatter === 'function' ? valueFormatter(item?.value, item) : String(item?.value ?? '');
          return (
            <div className="chartTooltipRow" key={`${String(item?.dataKey ?? name)}-${String(value)}`}>
              <span className="chartTooltipSwatch" style={{ backgroundColor: color }} />
              <span className="chartTooltipName">{name}</span>
              <strong>{value}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function readTimestamp(value) {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString('pt-BR');
  if (typeof value === 'string') return new Date(value).toLocaleString('pt-BR');
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString('pt-BR');
  return '';
}

export default App;
