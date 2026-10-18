import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ArrowLeft, BarChart3, CalendarDays, Download, FileSpreadsheet, FileText, ImageDown, RefreshCw, Search, X } from 'lucide-react';
import html2canvas from 'html2canvas';
import {
  applyMetaFilters,
  applyJustificationFilters,
  applyFilters,
  buildDailyTable,
  buildDailyTrend,
  buildMonthly,
  buildMonthlyByUmb,
  buildPlanDailyTable,
  buildPlanCombinedWaterfallRows,
  buildProjection,
  groupJustificationsByDate,
  normalizePlanName,
  totals,
  uniqueValues,
  uniquePlanValues
} from './lib/aggregate.js';
import { formatAxisKg, formatCompactPlanKg, formatDate, formatKg, formatMil, formatMonthYear, formatPlanWaterfallTick, monthNames } from './lib/format.js';
import { parseWorkbookToDashboard } from './lib/parseWorkbook.js';

const DEFAULT_SOURCE = 'https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit?usp=sharing&ouid=10613097494102742878&rtpof=true&sd=true';
const DEFAULT_REFRESH_SECONDS = 300;

function normalizeRefreshMs(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_REFRESH_SECONDS * 1000;
  return Math.min(Math.max(Math.round(seconds), DEFAULT_REFRESH_SECONDS), 24 * 60 * 60) * 1000;
}

async function fetchDashboardPayload() {
  const staticUrl = getStaticCacheUrl();
  const payload = await fetchJson(staticUrl);
  return normalizeDashboardPayload(payload, 'static-cache');
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

async function fetchLiveDashboardPayload(sourceUrl) {
  const workbookUrl = getWorkbookDownloadUrl(sourceUrl);
  const response = await fetch(withCacheBuster(workbookUrl), {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`A planilha respondeu com HTTP ${response.status}.`);
  }

  const buffer = await response.arrayBuffer();
  const signature = new Uint8Array(buffer.slice(0, 2));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error('A resposta da planilha não está no formato XLSX esperado.');
  }

  const dashboard = parseWorkbookToDashboard(buffer, {
    sourceUrl,
    finalUrl: response.url || workbookUrl
  });
  if (!dashboard.records.length) {
    throw new Error('A planilha foi lida, mas nenhuma linha de aplicação foi encontrada.');
  }

  dashboard.updatedAt = new Date().toISOString();
  dashboard.updatedBy = 'browser-direct';
  dashboard.source = sourceUrl;
  return normalizeDashboardPayload({ cache: dashboard }, 'direct-sheet');
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
  const [online, setOnline] = useState(false);
  const [dataSource, setDataSource] = useState('static');
  const [refreshing, setRefreshing] = useState(false);
  const directRefreshAtRef = useRef(0);

  const applyDashboardPayload = useCallback((payload) => {
    setCache(payload.cache);
    setStatus(payload.status || (payload.updatedAt ? {
      state: 'ok',
      lastSuccessAt: payload.updatedAt
    } : null));
    setConfig((old) => ({
      ...old,
      sourceUrl: payload.config?.sourceUrl || old.sourceUrl || DEFAULT_SOURCE,
      alertEmail: payload.config?.alertEmail || old.alertEmail,
      refreshSeconds: payload.config?.refreshSeconds || old.refreshSeconds || DEFAULT_REFRESH_SECONDS
    }));
  }, []);

  const refreshDashboard = useCallback(async (adminPassword) => {
    if (!adminPassword?.trim()) {
      throw new Error('Informe a senha administrativa para iniciar a atualização.');
    }

    setRefreshing(true);
    try {
      const payload = await fetchLiveDashboardPayload(config?.sourceUrl || DEFAULT_SOURCE);
      directRefreshAtRef.current = Date.parse(payload.updatedAt || '') || Date.now();
      applyDashboardPayload(payload);
      setDataSource('direct-sheet');
      setOnline(true);
      setStatus((old) => ({
        ...(old || {}),
        state: 'ok',
        lastSuccessAt: payload.updatedAt,
        lastError: null,
        checkedBy: 'browser-direct'
      }));
      return {
        ok: true,
        records: payload.cache.records.length,
        updatedAt: payload.updatedAt,
        changed: true
      };
    } catch (error) {
      throw new Error(error.message || 'Não foi possível ler a planilha na nuvem.');
    } finally {
      setRefreshing(false);
    }
  }, [applyDashboardPayload, config?.sourceUrl]);

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
        const staticUpdatedAt = Date.parse(payload.updatedAt || '');
        if (directRefreshAtRef.current && Number.isFinite(staticUpdatedAt) && staticUpdatedAt < directRefreshAtRef.current) {
          setOnline(true);
          return;
        }
        applyDashboardPayload(payload);
        setDataSource('static');
        setOnline(true);
      } catch (error) {
        if (!cancelled) {
          setOnline(false);
          setDataSource('static-error');
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
  }, [applyDashboardPayload, config?.refreshSeconds]);

  return (
    <div className="appShell">
      <Topbar />
      <main className="mainCanvas">
        <Dashboard cache={cache} status={status} config={config} dataSource={dataSource} onRefresh={refreshDashboard} refreshing={refreshing} route={route} online={online} />
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

const SIDEBAR_ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

// Ícones desenhados para o painel: traço uniforme de 1.7 px, cantos arredondados.
const SidebarIcons = {
  home: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
      <path d="M12 7.2c1.1 1.3 1.6 2.2 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.8.5-1.7 1.6-3z" />
    </svg>
  ),
  filter: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M3.5 5h17l-6.4 7.6V19l-4.2 2v-8.4z" />
    </svg>
  ),
  clearFilter: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M3.5 5h11.5l-4.6 5.5V16" />
      <path d="m15.5 13.5 5 5" />
      <path d="m20.5 13.5-5 5" />
    </svg>
  ),
  refresh: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M19.8 12a7.8 7.8 0 0 1-13.6 5.2" />
      <path d="M4.2 12a7.8 7.8 0 0 1 13.6-5.2" />
      <path d="M18.6 2.8v4.2h-4.2" />
      <path d="M5.4 21.2v-4.2h4.2" />
    </svg>
  ),
  report: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M13.5 3H6.8A1.8 1.8 0 0 0 5 4.8v14.4A1.8 1.8 0 0 0 6.8 21h10.4a1.8 1.8 0 0 0 1.8-1.8V7.5z" />
      <path d="M13.5 3v4.5H18" />
      <path d="M9 17.5v-3" />
      <path d="M12 17.5v-5.5" />
      <path d="M15 17.5v-2" />
    </svg>
  ),
  database: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <ellipse cx="9.5" cy="5.5" rx="6" ry="2.5" />
      <path d="M3.5 5.5v10c0 1.4 2.7 2.5 6 2.5" />
      <path d="M15.5 5.5v3.2" />
      <path d="M3.5 10.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
      <path d="M17.5 14.2v6.3" />
      <path d="m15 18 2.5 2.5L20 18" />
    </svg>
  ),
  calendar: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M8.5 14.5h.01" />
      <path d="M12 14.5h.01" />
      <path d="M15.5 14.5h.01" />
    </svg>
  ),
  pit: (
    <svg {...SIDEBAR_ICON_PROPS}>
      <path d="M3 18.5 9 9l3 4.5 2.5-3.5L21 18.5z" />
      <path d="M3 21h18" />
    </svg>
  )
};

function SideButton({ label, icon, active = false, pressed, disabled = false, onClick, href, download }) {
  if (href) {
    return (
      <a
        className={`sideButton ${active ? 'active' : ''}`}
        href={href}
        data-tip={label}
        aria-label={label}
        download={download}
        target={download ? '_blank' : undefined}
        rel={download ? 'noopener noreferrer' : undefined}
      >
        {icon}
      </a>
    );
  }
  return (
    <button
      className={`sideButton ${active ? 'active' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={label}
      aria-label={label}
      aria-pressed={pressed}
    >
      {icon}
    </button>
  );
}

function Sidebar({
  route,
  online,
  dataSource,
  filtersOpen,
  onToggleFilters,
  filtersActive,
  onClearFilters,
  currentMonthActive,
  onToggleCurrentMonth,
  refreshing,
  onOpenRefresh,
  onOpenReport,
  workbookDownloadUrl
}) {
  const connectionState = dataSource === 'connecting' ? 'isConnecting' : online ? 'isOnline' : 'isOffline';
  const connectionTitle = dataSource === 'firestore'
    ? 'Dados em tempo real'
    : dataSource === 'direct-sheet'
      ? 'Planilha lida diretamente agora'
    : dataSource === 'connecting'
      ? 'Conectando à fonte em nuvem'
      : online
        ? 'Cache online'
        : 'Falha ao ler cache';
  return (
    <aside className="sidebar">
      <SideButton href="#/" label="Dashboard" icon={SidebarIcons.home} active={route === '#/'} />
      <div className="sidebarGroup">
        <SideButton label="Filtros" icon={SidebarIcons.filter} active={filtersOpen} pressed={filtersOpen} onClick={onToggleFilters} />
        <SideButton label="Mês atual" icon={SidebarIcons.calendar} active={currentMonthActive} pressed={currentMonthActive} onClick={onToggleCurrentMonth} />
        <SideButton label="Limpar filtros" icon={SidebarIcons.clearFilter} disabled={!filtersActive} onClick={onClearFilters} />
      </div>
      <div className="sidebarGroup">
        <SideButton
          label={refreshing ? 'Atualizando dados...' : 'Atualizar dados'}
          icon={<span className={refreshing ? 'sideSpin' : undefined}>{SidebarIcons.refresh}</span>}
          disabled={refreshing}
          onClick={onOpenRefresh}
        />
        <SideButton label="Exportar relatório" icon={SidebarIcons.report} onClick={onOpenReport} />
        <SideButton label="Baixar base de dados (Excel)" icon={SidebarIcons.database} href={workbookDownloadUrl} download="base-dados-emulsao.xlsx" />
      </div>
      <span className={`connectionDot ${connectionState}`} title={connectionTitle} aria-label={connectionTitle} role="status" />
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

function Dashboard({ cache, status, config, dataSource, onRefresh, refreshing, route, online }) {
  const allRecords = cache?.records || [];
  const metas = cache?.metas || [];
  const allJustifications = cache?.justificativas || [];
  const planOptions = useMemo(() => uniquePlanValues(allRecords), [allRecords]);

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
  const [reportType, setReportType] = useState(null);
  const [reportDate, setReportDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);

  const dateRange = useMemo(() => {
    const dates = allRecords.map((r) => r.data).filter(Boolean).sort();
    return {
      start: dates[0] || '2026-01-01',
      end: dates[dates.length - 1] || '2026-12-31'
    };
  }, [allRecords]);

  const handleFilterChange = useCallback((field, value) => {
    if (field === 'poligonoSearch') {
      const selectedPlan = planOptions.find((plan) => normalizePlanName(plan) === normalizePlanName(value));
      if (selectedPlan) {
        setFilters((prev) => ({
          ...prev,
          poligonoSearch: selectedPlan,
          poligono: selectedPlan,
          umb: 'Todos',
          operador: 'Todos',
          year: 'Todos',
          month: 'Todos',
          startDate: dateRange.start,
          endDate: dateRange.end
        }));
        return;
      }
      setFilters((prev) => ({ ...prev, poligonoSearch: value, poligono: 'Todos' }));
      return;
    }

    if (field === 'poligono') {
      setFilters((prev) => ({ ...prev, poligono: value, poligonoSearch: '' }));
      return;
    }

    setFilters((prev) => ({ ...prev, [field]: value }));
  }, [dateRange.end, dateRange.start, planOptions]);

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

  const monthRange = getCurrentMonthRange();
  const currentMonthActive = filters.startDate === monthRange.start && filters.endDate === monthRange.end;
  // Primeiro clique aplica o mês atual; segundo volta o período para o intervalo completo dos dados.
  const toggleCurrentMonth = useCallback(() => {
    setFilters((prev) => {
      const monthActive = prev.startDate === monthRange.start && prev.endDate === monthRange.end;
      return {
        ...prev,
        startDate: monthActive ? dateRange.start : monthRange.start,
        endDate: monthActive ? dateRange.end : monthRange.end
      };
    });
  }, [dateRange.start, dateRange.end, monthRange.start, monthRange.end]);

  const filtersActive = filters.poligono !== 'Todos' || filters.umb !== 'Todos' || filters.operador !== 'Todos' || filters.year !== 'Todos' || filters.month !== 'Todos' || filters.poligonoSearch !== '' || filters.startDate !== dateRange.start || filters.endDate !== dateRange.end;

  // Painel de filtros fecha com segundo clique no botão, clique fora ou Esc.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onPointerDown = (event) => {
      if (event.target.closest?.('.sidebar, .filterFlyout')) return;
      setFiltersOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);

  const closeRefresh = useCallback(() => {
    if (!refreshing) setRefreshOpen(false);
  }, [refreshing]);

  const workbookDownloadUrl = getWorkbookDownloadUrl(config?.sourceUrl);

  const filteredRecords = useMemo(() => applyFilters(allRecords, filters), [allRecords, filters]);
  const filteredMetas = useMemo(() => applyMetaFilters(metas, filters), [metas, filters]);
  const filteredJustifications = useMemo(() => applyJustificationFilters(allJustifications, filters), [allJustifications, filters]);
  const justificationsByDate = useMemo(() => groupJustificationsByDate(filteredJustifications), [filteredJustifications]);

  const dailyRows = useMemo(() => buildDailyTable(filteredRecords), [filteredRecords]);
  const dailyTrend = useMemo(() => buildDailyTrend(filteredRecords, filteredMetas).map((row) => ({
    ...row,
    justificativas: justificationsByDate.get(row.data) || []
  })), [filteredRecords, filteredMetas, justificationsByDate]);
  const dailyTicks = useMemo(() => getDateTicks(dailyTrend), [dailyTrend]);
  const applicationDays = useMemo(() => new Set(
    filteredRecords.map((record) => String(record.data || '').slice(0, 10)).filter(Boolean)
  ).size, [filteredRecords]);
  const latestApplication = useMemo(() => filteredRecords
    .map((record) => String(record.data || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) || '', [filteredRecords]);
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
    setReportType('chooser');
  }, [dateRange.end, latestRecordDate]);

  const closeReport = useCallback(() => setReportType(null), []);

  const options = useMemo(() => ({
    poligonos: planOptions,
    umbs: uniqueValues(allRecords, 'umb'),
    operadores: uniqueValues(allRecords, 'operador'),
    years: Array.from(new Set(allRecords.map((r) => String(r.data || '').slice(0, 4)).filter(Boolean))).sort()
  }), [allRecords]);

  return (
    <>
    <Sidebar
      route={route}
      online={online}
      dataSource={dataSource}
      filtersOpen={filtersOpen}
      onToggleFilters={() => setFiltersOpen((open) => !open)}
      filtersActive={filtersActive}
      onClearFilters={handleClearFilters}
      currentMonthActive={currentMonthActive}
      onToggleCurrentMonth={toggleCurrentMonth}
      refreshing={refreshing}
      onOpenRefresh={() => setRefreshOpen(true)}
      onOpenReport={openReport}
      workbookDownloadUrl={workbookDownloadUrl}
    />
    <aside className={`filterFlyout ${filtersOpen ? 'isOpen' : ''}`} aria-label="Filtros">
      <div className="filterFlyoutHeader">
        <div>
          <span className="eyebrow">Painel</span>
          <h2>Filtros</h2>
        </div>
        <button className="iconButton" type="button" onClick={() => setFiltersOpen(false)} aria-label="Fechar filtros">
          <X size={20} />
        </button>
      </div>
      <FilterPanel
        filters={filters}
        onFilterChange={handleFilterChange}
        options={options}
        dateRange={dateRange}
      />
    </aside>
    <div className="topSearchBar" role="search">
      <div className="topSearchField">
        <span className="topSearchLabel">Buscar plano</span>
        <PlanSearchInput
          id="top-plan-suggestions"
          value={filters.poligonoSearch}
          onChange={(value) => handleFilterChange('poligonoSearch', value)}
          options={options.poligonos}
          placeholder="Digite o nome do plano para buscar..."
        />
      </div>
      {filtersActive ? (
        <button className="clearButton topSearchClear" type="button" onClick={handleClearFilters}>Limpar filtros</button>
      ) : null}
    </div>
    <div className="dashboardGrid">
      <section className="leftPanel">
        <PeriodSummary
          total={total}
          recordCount={filteredRecords.length}
          dayCount={applicationDays}
          justificationCount={filteredJustifications.length}
          latestApplication={latestApplication}
          dateRange={filters}
        />
        <DailyPanel rows={dailyRows} total={total} />
        <JustificationsPanel justifications={filteredJustifications} />
      </section>
      <section className="rightPanel">
        <StatusStrip
          total={total}
          latestApplication={latestApplication}
          status={status}
          cache={cache}
        />

        <DailyTrendChart data={dailyTrend} ticks={dailyTicks} />

        <ChartCard title="EMULSÃO: Aplicação Mensal" className="chartLarge">
          <div className="chartViewport chartViewportMonthly">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthly} margin={{ top: 24, right: 22, bottom: 8, left: 24 }}>
              <defs>
                <linearGradient id="emulsaoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#b00020" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#b00020" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e4e8eb" strokeDasharray="1 5" vertical={false} />
              <XAxis dataKey="mes" padding={{ left: 12, right: 12 }} minTickGap={14} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} padding={{ top: 12, bottom: 0 }} />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(v) => formatKg(v)}
                    labelFormatter={(label) => `Mes: ${label}`}
                  />
                }
              />
              <Area dataKey="aplicado" fill="url(#emulsaoFill)" stroke="none" legendType="none" />
              <Line type="monotone" dataKey="aplicado" stroke="#9b0016" strokeWidth={3} dot={{ r: 4, fill: '#9b0016' }} activeDot={{ r: 6 }}>
                <LabelList
                  dataKey="aplicado"
                  position="top"
                  offset={8}
                  formatter={formatMil}
                  fill="#9b0016"
                  fontSize={9}
                  fontWeight={700}
                />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="EMULSÃO: Aplicação Mensal/UMB" className="chartMedium">
          <div className="chartViewport chartViewportUmb">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyByUmb} margin={{ top: 12, right: 20, bottom: 12, left: 0 }}>
              <CartesianGrid stroke="#e4e8eb" strokeDasharray="1 5" vertical={false} />
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
              <Bar dataKey="aplicado" name="Aplicado" fill="#e30613" radius={[2, 2, 0, 0]} maxBarSize={48}>
                <LabelList
                  dataKey="aplicado"
                  position="inside"
                  formatter={formatMil}
                  fill="#fff"
                  fontSize={10}
                  fontWeight={700}
                  textAnchor="middle"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="PROJEÇÃO: Aplicação Mensal de Emulsão" className="chartProjection">
          <div className="projectionHeader">
            <span>Legenda:</span>
            <span className="dot dark" /> Ritmo
            <span className="dot red" /> Aplicado
          </div>
          <div className="chartViewport chartViewportProjection">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={projection} margin={{ top: 10, right: 58, bottom: 10, left: 12 }}>
              <CartesianGrid stroke="#e4e8eb" strokeDasharray="1 5" horizontal={false} />
              <XAxis type="number" tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => formatKg(v)} />} />
              <Bar dataKey="value" radius={[0, 2, 2, 0]} fill="#b00020" barSize={18}>
                <LabelList
                  dataKey="value"
                  position="inside"
                  formatter={formatMil}
                  fill="#fff"
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="middle"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </ChartCard>

      </section>
      {reportType === 'chooser' ? (
        <ReportChooser
          onSelect={setReportType}
          onClose={closeReport}
        />
      ) : null}
      {reportType === 'one-page' ? (
        <ReportModal
          allRecords={allRecords}
          justifications={allJustifications}
          filters={filters}
          date={reportDate}
          dateBounds={reportDateBounds}
          onDateChange={setReportDate}
          onBack={() => setReportType('chooser')}
          onClose={closeReport}
        />
      ) : null}
      {reportType === 'plan' ? (
        <PlanReportModal
          allRecords={allRecords}
          onBack={() => setReportType('chooser')}
          onClose={closeReport}
        />
      ) : null}
    </div>
    {refreshOpen ? (
      <RefreshDialog onRefresh={onRefresh} refreshing={refreshing} onClose={closeRefresh} />
    ) : null}
    </>
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

function StatusStrip({ total, latestApplication, status, cache }) {
  const failed = status?.state === 'error';
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
        {failed && status?.lastError ? <small className="statusError" title={status.lastError}>Falha na última verificação</small> : null}
      </div>
    </div>
  );
}

function RefreshDialog({ onRefresh, refreshing, onClose }) {
  const [adminPassword, setAdminPassword] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshSuccess, setRefreshSuccess] = useState('');
  const passwordInputRef = useRef(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => passwordInputRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !refreshing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [refreshing, onClose]);

  const submitRefresh = async (event) => {
    event.preventDefault();
    const password = adminPassword.trim();
    if (!password) {
      setRefreshError('Informe a senha administrativa para iniciar a atualização.');
      return;
    }

    setRefreshError('');
    setRefreshSuccess('');
    try {
      const result = await onRefresh(password);
      const records = Number(result?.records);
      const recordLabel = Number.isFinite(records) && records > 0 ? ` ${records.toLocaleString('pt-BR')} registros foram processados.` : '';
      setRefreshSuccess(`Dados lidos diretamente da planilha.${recordLabel}`);
      setAdminPassword('');
    } catch (error) {
      setRefreshError(error.message || 'Não foi possível atualizar os dados.');
    }
  };

  return (
    <div
      className="refreshOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refresh-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !refreshing) onClose();
      }}
    >
      <form className="refreshDialog" onSubmit={submitRefresh}>
        <div className="refreshDialogHeader">
          <div>
            <span className="eyebrow">Leitura direta da nuvem</span>
            <h2 id="refresh-title">Atualizar Dados</h2>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={refreshing} aria-label="Fechar atualização">
            <X size={20} />
          </button>
        </div>
        <p className="refreshLead">
          A planilha será lida diretamente do Google Sheets. Depois da confirmação, os dados desta tela são atualizados na hora, sem depender do seu computador ou do n8n.
        </p>
        <label className="refreshPasswordField">
          <span>Senha administrativa</span>
          <input
            ref={passwordInputRef}
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            autoComplete="off"
            spellCheck="false"
            placeholder="Digite a senha administrativa"
            disabled={refreshing || Boolean(refreshSuccess)}
          />
        </label>
        <p className="refreshHint">A senha é usada somente como confirmação desta solicitação. Ela não é enviada nem salva no navegador, no código ou no GitHub.</p>
        {refreshError ? <div className="refreshFeedback error" role="alert">{refreshError}</div> : null}
        {refreshSuccess ? <div className="refreshFeedback success" role="status">{refreshSuccess} O cache público será republicado automaticamente pelo GitHub Actions.</div> : null}
        <div className="refreshActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={refreshing}>
            {refreshSuccess ? 'Fechar' : 'Cancelar'}
          </button>
          {!refreshSuccess ? (
            <button className="primaryButton" type="submit" disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Lendo planilha...' : 'Confirmar atualização'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ReportChooser({ onSelect, onClose }) {
  return (
    <div className="reportOverlay" role="dialog" aria-modal="true" aria-labelledby="report-chooser-title">
      <div className="reportDialog reportChooserDialog">
        <div className="reportDialogHeader">
          <div>
            <span className="eyebrow">Exportação rápida</span>
            <h2 id="report-chooser-title">Escolha o relatório</h2>
            <p>Selecione o formato que melhor responde à sua análise operacional.</p>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Fechar seleção de relatório"><X size={20} /></button>
        </div>
        <div className="reportTypeGrid">
          <button className="reportTypeCard" type="button" onClick={() => onSelect('one-page')} data-testid="report-type-one-page">
            <span className="reportTypeIcon"><ImageDown size={22} /></span>
            <span className="reportTypeCardBody">
              <strong>Relatório de Aplicação Diária</strong>
              <small>Resumo do mês até a data de referência, com indicadores e aplicação detalhada do dia.</small>
            </span>
            <span className="reportTypeAction">Escolher <span aria-hidden="true">›</span></span>
          </button>
          <button className="reportTypeCard reportTypeCardFeatured" type="button" onClick={() => onSelect('plan')} data-testid="report-type-plan">
            <span className="reportTypeIcon"><BarChart3 size={22} /></span>
            <span className="reportTypeCardBody">
              <strong>Relatório de Aplicação por Plano</strong>
              <small>Pesquise um plano e veja furos, emulsão por dia de carregamento, total e gráfico de cascata.</small>
            </span>
            <span className="reportTypeAction">Escolher <span aria-hidden="true">›</span></span>
          </button>
        </div>
        <p className="reportChooserHint">Os dois relatórios podem ser baixados em PNG (imagem) ou PDF, prontos para compartilhar.</p>
      </div>
    </div>
  );
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function renderReportCanvas(element) {
  const bounds = element.getBoundingClientRect();
  return html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: Math.max(2, 1920 / Math.max(bounds.width, 1)),
    useCORS: true,
    logging: false
  });
}

function fitReportCanvas(previewCanvas, fitTo) {
  const canvas = document.createElement('canvas');
  canvas.width = fitTo.width;
  canvas.height = fitTo.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, fitTo.width, fitTo.height);
  // min mantém o relatório inteiro dentro do quadro; max cortava topo e base quando ele ficava mais alto que 16:9.
  const fitScale = Math.min(fitTo.width / previewCanvas.width, fitTo.height / previewCanvas.height);
  const drawWidth = previewCanvas.width * fitScale;
  const drawHeight = previewCanvas.height * fitScale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(previewCanvas, (fitTo.width - drawWidth) / 2, (fitTo.height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

async function exportReportPng(element, { filename, fitTo = null }) {
  const previewCanvas = await renderReportCanvas(element);
  downloadCanvas(fitTo ? fitReportCanvas(previewCanvas, fitTo) : previewCanvas, filename);
}

function ReportModal({ allRecords, justifications, filters, date, dateBounds, onDateChange, onBack, onClose }) {
  const reportRef = useRef(null);
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const selectedDate = String(date || '').slice(0, 10);
  const monthStart = selectedDate ? `${selectedDate.slice(0, 7)}-01` : '';
  const baseFilters = { ...filters, startDate: monthStart, endDate: selectedDate };
  const dayFilters = { ...filters, startDate: selectedDate, endDate: selectedDate };
  const monthRecords = applyFilters(allRecords, baseFilters);
  const dayRecords = applyFilters(allRecords, dayFilters);
  const dayJustifications = applyJustificationFilters(justifications, dayFilters);
  const monthTotal = totals(monthRecords);
  const dayTotal = totals(dayRecords);
  const dayByPolygon = buildDailyTable(dayRecords);

  const exportReport = async (format) => {
    if (!selectedDate || (format === 'png' && !reportRef.current)) return;
    setExporting(format);
    setExportError('');
    try {
      if (format === 'pdf') {
        const { createDailyReportPdf, loadReportLogos } = await import('./lib/reportPdf.js');
        createDailyReportPdf({ selectedDate, monthStart, monthTotal, dayTotal, dayByPolygon, dayJustifications, logos: await loadReportLogos() })
          .save(`relatorio-emulsao-${selectedDate}.pdf`);
      } else {
        await exportReportPng(reportRef.current, {
          filename: `relatorio-emulsao-${selectedDate}.png`,
          fitTo: { width: 2000, height: 1279 }
        });
      }
    } catch (error) {
      setExportError(error.message || 'Não foi possível gerar o relatório.');
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="reportOverlay" role="dialog" aria-modal="true" aria-labelledby="report-daily-title">
      <div className="reportDialog">
        <div className="reportDialogHeader">
          <div>
            <span className="eyebrow">Exportação rápida</span>
            <h2 id="report-daily-title">Relatório de Aplicação Diária</h2>
            <p>Consolida o mês até a data escolhida.</p>
          </div>
          <div className="reportHeaderActions">
            <button className="reportBackButton" type="button" onClick={onBack}><ArrowLeft size={15} /> Relatórios</button>
            <button className="iconButton" type="button" onClick={onClose} aria-label="Fechar relatório"><X size={20} /></button>
          </div>
        </div>
        <label className="reportDateField">
          <span><CalendarDays size={16} /> Data da aplicação</span>
          <input type="date" value={selectedDate} min={dateBounds.start} max={dateBounds.end} onChange={(event) => onDateChange(event.target.value)} />
        </label>
        <div className="reportPreview dailyReportPreview" ref={reportRef}>
          <div className="reportHeading">
            <div><h3>Aplicação de Emulsão</h3><p>{formatMonthYear(selectedDate)} · até {formatDate(selectedDate) || '-'}</p></div>
            <div className="reportLogos"><img className="reportLogo" src="assets/Enaex Brasil.png" alt="Enaex" /><img className="reportLogo reportLogoClient" src="assets/Mineracao Vale Verde.png" alt="Mineração Vale Verde" /></div>
          </div>
          <div className="dailyReportBody">
            <div className="reportMetricPanel dailyReportMetrics">
              <ReportKpi label="Aplicado no mês" value={formatKg(monthTotal.emulsao)} tone="red" sub={`${monthTotal.registros.toLocaleString('pt-BR')} registros no mês`} />
              <ReportKpi label="Aplicado no dia" value={formatKg(dayTotal.emulsao)} tone="gray" />
              <ReportKpi label="Furos no dia" value={dayTotal.furos.toLocaleString('pt-BR')} tone="dark" />
            </div>
            <section className="dailyReportSection">
              <h4 className="dailyReportTitle">Planos do dia</h4>
              {dayByPolygon.length ? (
                <div className="dailyReportTable" role="table" aria-label="Planos do dia">
                  <div className="dailyReportTableHeader" role="row"><span role="columnheader">Plano</span><span role="columnheader">Emulsão</span><span role="columnheader">Furos</span></div>
                  {dayByPolygon.map((row) => (
                    <div className="dailyReportTableRow" role="row" key={`${row.data}-${row.poligono}`}>
                      <span role="cell">{row.poligono || 'Sem plano'}</span>
                      <span role="cell">{formatKg(row.emulsao)}</span>
                      <span role="cell">{row.furos.toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="dailyReportEmpty">Nenhuma aplicação nesta data.</p>}
            </section>
            <section className="dailyReportSection">
              <h4 className="dailyReportTitle">Justificativas</h4>
              <JustificationList justifications={dayJustifications} emptyText="Nenhuma." />
            </section>
          </div>
          <p className="dailyReportNote">Mês: {formatDate(monthStart)} até a data · Dia: somente a data, por plano.</p>
          <div className="reportFooter"><span>STRICTLY PRIVATE AND CONFIDENTIAL</span></div>
        </div>
         {exportError ? <div className="refreshFeedback error" role="alert">{exportError}</div> : null}
         <div className="reportActions">
           <button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button>
          <button className="outlineButton" type="button" onClick={() => exportReport('png')} disabled={!selectedDate || Boolean(exporting)}><Download size={17} /> {exporting === 'png' ? 'Gerando imagem...' : 'Baixar imagem PNG'}</button>
          <button className="primaryButton" type="button" onClick={() => exportReport('pdf')} disabled={!selectedDate || Boolean(exporting)}><FileText size={17} /> {exporting === 'pdf' ? 'Gerando PDF...' : 'Baixar relatório PDF'}</button>
        </div>
      </div>
    </div>
  );
}

function normalizePlanSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function PlanReportModal({ allRecords, onBack, onClose }) {
  const reportRef = useRef(null);
  const [planSearch, setPlanSearch] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const plans = useMemo(() => uniquePlanValues(allRecords), [allRecords]);
  const planSummaries = useMemo(() => plans.map((plan) => {
    const rows = buildPlanDailyTable(allRecords, plan);
    const planTotal = totals(rows);
    return {
      plan,
      days: rows.length,
      emulsao: planTotal.emulsao,
      furos: planTotal.furos,
      firstDate: rows[0]?.data || '',
      lastDate: rows.at(-1)?.data || ''
    };
  }), [allRecords, plans]);
  const visiblePlans = useMemo(() => {
    const query = normalizePlanSearch(planSearch);
    if (!query) return planSummaries;
    return planSummaries.filter((item) => normalizePlanSearch(item.plan).includes(query));
  }, [planSearch, planSummaries]);
  const suggestions = visiblePlans.slice(0, 8);
  const dailyRows = useMemo(() => buildPlanDailyTable(allRecords, selectedPlan), [allRecords, selectedPlan]);
  const planTotal = useMemo(() => totals(dailyRows), [dailyRows]);
  const combinedWaterfallRows = useMemo(() => buildPlanCombinedWaterfallRows(dailyRows), [dailyRows]);
  const firstDate = dailyRows[0]?.data || '';
  const lastDate = dailyRows.at(-1)?.data || '';
  const safePlanName = selectedPlan.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'plano';

  const choosePlan = (plan) => {
    setSelectedPlan(plan);
    setPlanSearch(plan);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  };

  const handlePlanSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveSuggestion((current) => event.key === 'ArrowDown'
        ? (current + 1) % suggestions.length
        : (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && suggestionsOpen && suggestions.length) {
      event.preventDefault();
      choosePlan(suggestions[activeSuggestion >= 0 ? activeSuggestion : 0].plan);
    }
  };

  const exportReport = async (format) => {
    if (!selectedPlan || !dailyRows.length || (format === 'png' && !reportRef.current)) return;
    setExporting(format);
    setExportError('');
    try {
      if (format === 'pdf') {
        const { createPlanReportPdf, loadReportLogos } = await import('./lib/reportPdf.js');
        createPlanReportPdf({
          plan: selectedPlan,
          dailyRows,
          planTotal,
          firstDate,
          lastDate,
          waterfallRows: combinedWaterfallRows,
          logos: await loadReportLogos()
        }).save(`relatorio-emulsao-plano-${safePlanName}.pdf`);
      } else {
        await exportReportPng(reportRef.current, { filename: `relatorio-emulsao-plano-${safePlanName}.png` });
      }
    } catch (error) {
      setExportError(error.message || 'Não foi possível gerar o relatório.');
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="reportOverlay" role="dialog" aria-modal="true" aria-labelledby="report-plan-title">
      <div className="reportDialog planReportDialog">
        <div className="reportDialogHeader">
          <div>
            <span className="eyebrow">Exportação detalhada</span>
            <h2 id="report-plan-title">Relatório de Aplicação por Plano</h2>
            <p>Pesquise o plano, selecione-o e acompanhe a carga dia a dia.</p>
          </div>
          <div className="reportHeaderActions">
            <button className="reportBackButton" type="button" onClick={onBack}><ArrowLeft size={15} /> Relatórios</button>
            <button className="iconButton" type="button" onClick={onClose} aria-label="Fechar relatório por plano"><X size={20} /></button>
          </div>
        </div>

        <div className="planSearchPanel">
          <label className="planSearchField">
            <span><Search size={16} /> Pesquisar nome do plano</span>
            <div className="planSearchControl">
              <input
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen}
                aria-controls={suggestionsOpen ? 'plan-suggestions' : undefined}
                aria-activedescendant={activeSuggestion >= 0 ? `plan-suggestion-${activeSuggestion}` : undefined}
                value={planSearch}
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(event) => {
                  setPlanSearch(event.target.value);
                  setSuggestionsOpen(true);
                  setActiveSuggestion(-1);
                }}
                onKeyDown={handlePlanSearchKeyDown}
                onBlur={() => {
                  setSuggestionsOpen(false);
                  setActiveSuggestion(-1);
                }}
                placeholder="Ex.: PP560926"
                autoComplete="off"
                data-testid="plan-search"
              />
              {suggestionsOpen ? (
                <div className="planSuggestions" id="plan-suggestions" role="listbox" aria-label="Sugestões de planos">
                  {suggestions.length ? suggestions.map((item, index) => (
                    <button
                      className={`planSuggestion ${index === activeSuggestion ? 'isActive' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={selectedPlan === item.plan}
                      id={`plan-suggestion-${index}`}
                      key={item.plan}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choosePlan(item.plan)}
                    >
                      <span className="planSuggestionName">{item.plan}</span>
                      <span className="planSuggestionMeta">
                        {formatDate(item.firstDate)} — {formatDate(item.lastDate)} · {item.days.toLocaleString('pt-BR')} {item.days === 1 ? 'dia' : 'dias'} · {formatKg(item.emulsao)} · {item.furos.toLocaleString('pt-BR')} furos
                      </span>
                    </button>
                  )) : <p className="planEmptyState">Nenhum plano corresponde à pesquisa.</p>}
                  {visiblePlans.length > suggestions.length ? <div className="planSuggestionMore">Digite mais letras para filtrar {visiblePlans.length.toLocaleString('pt-BR')} planos.</div> : null}
                </div>
              ) : null}
            </div>
          </label>
          <div className="planResultsHeader"><span>{visiblePlans.length.toLocaleString('pt-BR')} planos encontrados no histórico</span><small>{selectedPlan ? `Selecionado: ${selectedPlan}` : 'Digite para ver sugestões de todos os meses'}</small></div>
        </div>

        {selectedPlan && dailyRows.length ? (
          <div className="reportPreview planReportPreview" ref={reportRef}>
            <div className="reportHeading">
              <div><h3>{selectedPlan}</h3><p>Relatório de Aplicação por Plano · dias de carregamento.</p></div>
              <div className="reportLogos"><img className="reportLogo" src="assets/Enaex Brasil.png" alt="Enaex" /><img className="reportLogo reportLogoClient" src="assets/Mineracao Vale Verde.png" alt="Mineração Vale Verde" /></div>
            </div>
            <div className="reportTitleLine">Emulsão aplicada por dia de carregamento:</div>
            <div className="reportMetricPanel planReportMetrics">
              <div className="reportMetricItem"><span>Período do plano</span><strong>{formatDate(firstDate)} — {formatDate(lastDate)}</strong></div>
              <ReportKpi label="Emulsão aplicada" value={formatKg(planTotal.emulsao)} tone="red" />
              <ReportKpi label="Furos carregados" value={planTotal.furos.toLocaleString('pt-BR')} tone="gray" />
              <ReportKpi label="Dias de carregamento" value={dailyRows.length.toLocaleString('pt-BR')} tone="dark" />
            </div>
            <div className="planReportTableBlock">
              <div className="reportSectionHeading"><span className="reportSectionLabel">Aplicação por dia de carregamento</span><small>{dailyRows.length.toLocaleString('pt-BR')} {dailyRows.length === 1 ? 'dia consolidado' : 'dias consolidados'}</small></div>
              <div className="reportDataTableWrap">
                <table className="reportDataTable">
                  <thead><tr><th>Dia de carregamento</th><th>Furos carregados</th><th>Emulsão aplicada</th></tr></thead>
                  <tbody>{dailyRows.map((row) => <tr key={row.data}><td>{row.dia}</td><td>{row.furos.toLocaleString('pt-BR')}</td><td>{formatKg(row.emulsao)}</td></tr>)}</tbody>
                  <tfoot><tr><td>Total</td><td>{planTotal.furos.toLocaleString('pt-BR')}</td><td>{formatKg(planTotal.emulsao)}</td></tr></tfoot>
                </table>
              </div>
            </div>
            <div className="planReportChartBlock">
              <div className="reportSectionHeading"><span className="reportSectionLabel">Gráfico de cascata</span><small>Emulsão acima da barra · furos no centro</small></div>
              <div className="planWaterfallGrid">
                <PlanWaterfallChart
                  rows={combinedWaterfallRows}
                  ariaLabel={`Gráfico de cascata da emulsão aplicada em kg, com furos carregados no centro das barras, no plano ${selectedPlan}`}
                />
              </div>
            </div>
            <ReportFooter note="os valores são a emulsão aplicada (kg) e os furos carregados em cada dia de carregamento do plano. No gráfico de cascata, cada barra vermelha soma a emulsão do dia sobre o acumulado anterior (valor acima da barra) e traz os furos no centro; a barra escura é o total do plano." />
          </div>
        ) : (
          <div className="planReportEmpty" data-testid="plan-report-empty">
            <span className="reportTypeIcon"><BarChart3 size={22} /></span>
            <strong>{selectedPlan ? 'Nenhum carregamento encontrado para este plano.' : 'Selecione um plano para gerar o relatório'}</strong>
            <small>{selectedPlan ? 'Verifique a origem dos dados ou escolha outro plano.' : 'A tabela e o gráfico de cascata aparecerão aqui após a seleção.'}</small>
          </div>
        )}

        {exportError ? <div className="refreshFeedback error" role="alert">{exportError}</div> : null}
        <div className="reportActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button>
          <button className="outlineButton" type="button" onClick={() => exportReport('png')} disabled={!selectedPlan || !dailyRows.length || Boolean(exporting)}><Download size={17} /> {exporting === 'png' ? 'Gerando imagem...' : 'Baixar relatório PNG'}</button>
          <button className="primaryButton" type="button" onClick={() => exportReport('pdf')} disabled={!selectedPlan || !dailyRows.length || Boolean(exporting)}><FileText size={17} /> {exporting === 'pdf' ? 'Gerando PDF...' : 'Baixar relatório PDF'}</button>
        </div>
      </div>
    </div>
  );
}

function ReportFooter({ note }) {
  return (
    <>
      <p className="reportNote"><strong>Atenção,</strong> {note}</p>
      <div className="reportFooter"><span>STRICTLY PRIVATE AND CONFIDENTIAL</span></div>
    </>
  );
}

function ReportKpi({ label, value, tone, sub = null }) {
  return <div className={`reportKpi ${tone}`}><span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>;
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

function JustificationsPanel({ justifications }) {
  return (
    <div className="panel justificationsPanel">
      <div className="tableHeader">
        <h2>JUSTIFICATIVAS</h2>
        <span className="tableMeta">{justifications.length.toLocaleString('pt-BR')} registros</span>
      </div>
      <JustificationList justifications={justifications} emptyText="Nenhuma justificativa registrada para os filtros selecionados." />
    </div>
  );
}

function JustificationList({ justifications, emptyText }) {
  if (!justifications.length) return <p className="justificationEmpty">{emptyText}</p>;
  return (
    <div className="justificationList">
      {justifications.map((item, index) => (
        <div className="justificationItem" key={`${item.data}-${item.poligono}-${item.motivo}-${index}`}>
          <div className="justificationMeta"><strong>{formatDate(item.data)}</strong><span>{item.poligono || 'Geral'}</span></div>
          <p>{item.motivo}</p>
        </div>
      ))}
    </div>
  );
}

function FilterPanel({ filters, onFilterChange, options, dateRange }) {
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
        <PlanSearchInput
          id="dashboard-plan-suggestions"
          value={filters.poligonoSearch}
          onChange={(value) => onFilterChange('poligonoSearch', value)}
          options={options.poligonos}
        />
        <select value={filters.poligono} onChange={handlePoligono}>
          <option value="Todos">Todos</option>
          {options.poligonos.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <p className="filterHint">Selecione uma sugestão para abrir o histórico completo do plano.</p>
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
    </div>
  );
}

// Campo de busca de planos: mesma lógica usada no painel de filtros e na busca do topo.
function PlanSearchInput({ id, value, onChange, options, placeholder = 'Digite para buscar planos...' }) {
  return (
    <div className="planSearchInput">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={id}
        aria-label="Buscar plano pelo nome"
        placeholder={placeholder}
      />
      <datalist id={id}>
        {options.map((item) => <option key={item} value={item} />)}
      </datalist>
    </div>
  );
}

function PeriodSummary({ total, recordCount, dayCount, justificationCount, latestApplication, dateRange }) {
  return (
    <section className="panel periodSummary" aria-label="Resumo do período">
      <div className="periodSummaryHeader">
        <div>
          <h2>RESUMO DO PERÍODO</h2>
          <p className="periodSummarySub">Indicadores do intervalo filtrado</p>
        </div>
      </div>
      <div className="periodSummaryGrid">
        <div className="summaryMetric summaryMetricAccent">
          <span>Emulsão aplicada</span>
          <strong>{formatKg(total.emulsao)}</strong>
          <small>kg no período selecionado</small>
        </div>
        <div className="summaryMetric">
          <span>Furos realizados</span>
          <strong>{total.furos.toLocaleString('pt-BR')}</strong>
          <small>{recordCount.toLocaleString('pt-BR')} registros de aplicação</small>
        </div>
        <div className="summaryMetric">
          <span>Dias com aplicação</span>
          <strong>{dayCount.toLocaleString('pt-BR')}</strong>
          <small>última: {formatDate(latestApplication) || '-'}</small>
        </div>
        <div className="summaryMetric">
          <span>Justificativas</span>
          <strong>{justificationCount.toLocaleString('pt-BR')}</strong>
          <small>registros associados ao período</small>
        </div>
      </div>
      <div className="periodSummaryFooter">
        <span>Janela analisada</span>
        <strong>{formatDate(dateRange.startDate) || '-'} — {formatDate(dateRange.endDate) || '-'}</strong>
      </div>
    </section>
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

function TooltipJustifications({ items }) {
  if (!items?.length) return null;
  return <div className="chartTooltipJustification"><span>Justificativa</span>{items.map((item, index) => <p key={`${item.poligono}-${item.motivo}-${index}`}><strong>{item.poligono || 'Geral'}:</strong> {item.motivo}</p>)}</div>;
}

function DailyTrendChart({ data, ticks }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const clearHoverRef = useRef(null);

  useEffect(() => {
    setHoveredPoint(null);
  }, [data]);

  useEffect(() => () => {
    if (clearHoverRef.current) window.clearTimeout(clearHoverRef.current);
  }, []);

  const keepTooltipVisible = useCallback(() => {
    if (clearHoverRef.current) {
      window.clearTimeout(clearHoverRef.current);
      clearHoverRef.current = null;
    }
  }, []);

  const handleMouseMove = useCallback((state) => {
    keepTooltipVisible();
    const point = state?.activePayload?.[0]?.payload || null;
    setHoveredPoint((previous) => previous?.data === point?.data ? previous : point);
  }, [keepTooltipVisible]);

  const handleMouseLeave = useCallback(() => {
    clearHoverRef.current = window.setTimeout(() => {
      setHoveredPoint(null);
      clearHoverRef.current = null;
    }, 120);
  }, []);

  return (
    <ChartCard title="EMULSÃO: Aplicação Dia a Dia" className="chartDailyTrend">
      <div className="chartViewport chartViewportDaily">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 22, bottom: 8, left: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="dailyEmulsaoFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e30613" stopOpacity={0.14} />
                <stop offset="95%" stopColor="#e30613" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e4e8eb" strokeDasharray="1 5" vertical={false} />
            <XAxis dataKey="dia" ticks={ticks} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={8} />
            <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} />
            <Tooltip
              content={() => null}
              cursor={{ stroke: '#38424B', strokeDasharray: '3 3', strokeWidth: 1 }}
            />
            <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="aplicado" fill="url(#dailyEmulsaoFill)" stroke="none" legendType="none" />
            <Line type="monotone" dataKey="aplicado" name="Aplicado" stroke="#e30613" strokeWidth={2.6} dot={false} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="mediaMovel" name="Media movel 7d" stroke="#00A79D" strokeWidth={2.4} dot={false} activeDot={{ r: 4, fill: '#00A79D' }} />
            <Line type="monotone" dataKey="meta" name="Meta" stroke="#B8A53D" strokeWidth={2.2} strokeDasharray="7 5" dot={false} activeDot={{ r: 4, fill: '#B8A53D' }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {hoveredPoint ? (
        <div
          className="chartTooltipDock"
          aria-label="Detalhes do ponto selecionado"
          onMouseEnter={keepTooltipVisible}
          onMouseLeave={handleMouseLeave}
        >
          <DailyTrendHoverCard point={hoveredPoint} />
        </div>
      ) : null}
    </ChartCard>
  );
}

function DailyTrendHoverCard({ point }) {
  const payload = [
    { dataKey: 'aplicado', name: 'Aplicado', value: point.aplicado, color: '#e30613', payload: point },
    { dataKey: 'mediaMovel', name: 'Media movel 7d', value: point.mediaMovel, color: '#00A79D', payload: point },
    { dataKey: 'meta', name: 'Meta', value: point.meta, color: '#B8A53D', payload: point }
  ].filter((item) => item.value != null);

  return (
    <ChartTooltip
      active
      payload={payload}
      label={`Data: ${formatDate(point.data)}`}
      valueFormatter={(value) => formatKg(value)}
      extraContent={(items) => <TooltipJustifications items={items?.[0]?.payload?.justificativas || []} />}
    />
  );
}

// Sem grade nem eixo Y: os valores ficam nas barras (data labels); o eixo X só tem uma linha de base.
function PlanWaterfallChart({ rows, ariaLabel }) {
  return (
    <div className="planMetricChart">
      <div className="reportWaterfallViewport" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 34, right: 22, bottom: 10, left: 12 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#3C3F45' }}
              tickFormatter={formatPlanWaterfallTick}
              axisLine={{ stroke: '#C4C7CC', strokeWidth: 1 }}
              tickLine={false}
              minTickGap={0}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <Tooltip content={<PlanWaterfallTooltip valueFormatter={formatKg} valueLabel="Emulsão aplicada" />} cursor={{ fill: 'rgba(56,66,75,.06)' }} />
            <Bar dataKey="base" stackId="waterfall" fill="transparent" stroke="transparent" isAnimationActive={false} legendType="none" />
            <Bar dataKey="value" name="Emulsão aplicada (kg)" stackId="waterfall" isAnimationActive={false}>
              {rows.map((row) => <Cell key={`${row.label}-${row.data}`} fill={row.isTotal ? '#3C3F45' : '#B5121B'} />)}
              <LabelList dataKey="displayValue" content={<PlanWaterfallEmulsionLabel />} />
              <LabelList dataKey="furos" content={<PlanWaterfallHoleLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PlanWaterfallEmulsionLabel({ viewBox, value }) {
  const { x = 0, y = 0, width = 0 } = viewBox || {};
  if (!width) return null;

  return (
    <text className="planWaterfallEmulsionLabel" x={x + width / 2} y={Math.max(y - 9, 12)} textAnchor="middle" fill="#3C3F45" fontSize={11} fontWeight={700}>
      {formatCompactPlanKg(value)}
    </text>
  );
}

function PlanWaterfallHoleLabel({ viewBox, value }) {
  const { x = 0, y = 0, width = 0, height = 0 } = viewBox || {};
  const holeCount = Number(value);
  if (!width || !height || !Number.isFinite(holeCount)) return null;

  const holeLabel = holeCount.toLocaleString('pt-BR');
  const fontSize = Math.min(10, Math.max(7, (width - 2) / (holeLabel.length * 0.55)));

  return (
    <text className="planWaterfallHoleLabel" x={x + width / 2} y={y + height / 2} dy=".35em" textAnchor="middle" fill="#fff" style={{ fontSize }} fontWeight={800}>
      {holeLabel}
    </text>
  );
}

function PlanWaterfallTooltip({ active, payload, label, valueFormatter = formatKg, valueLabel = 'Emulsão aplicada' }) {
  if (!active || !payload?.length) return null;
  const valueItem = payload.find((item) => item?.dataKey === 'value');
  if (!valueItem) return null;
  const isTotal = Boolean(valueItem.payload?.isTotal);
  const holes = valueItem.payload?.furos;
  return (
    <div className="chartTooltip">
      <div className="chartTooltipLabel">{label}</div>
      <div className="chartTooltipItems">
        <div className="chartTooltipRow">
          <span className="chartTooltipSwatch" style={{ backgroundColor: isTotal ? '#38424B' : '#E20613' }} />
          <span className="chartTooltipName">{isTotal ? `Total de ${valueLabel.toLocaleLowerCase('pt-BR')}` : valueLabel}</span>
          <strong>{valueFormatter(valueItem.value)}</strong>
        </div>
        <div className="chartTooltipRow">
          <span className="chartTooltipSwatch" style={{ backgroundColor: '#38424B' }} />
          <span className="chartTooltipName">Furos carregados</span>
          <strong>{Number(holes || 0).toLocaleString('pt-BR')} furos</strong>
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, extraContent }) {
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
      {typeof extraContent === 'function' ? extraContent(uniqueItems) : null}
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
