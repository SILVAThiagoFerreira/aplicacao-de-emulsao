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
      <h1>Emulsao</h1>
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

  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }, []);

  const dateRange = useMemo(() => {
    const dates = allRecords.map((r) => r.data).filter(Boolean).sort();
    return {
      start: dates[0] || '2026-01-01',
      end: dates[dates.length - 1] || '2026-12-31'
    };
  }, [allRecords]);

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
          options={options}
          dateRange={dateRange}
        />
      </section>
      <section className="rightPanel">
        <StatusStrip cache={cache} status={status} config={config} total={total} latestApplication={latestApplication} />

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
    </div>
  );
}

function StatusStrip({ cache, status, config, total, latestApplication }) {
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
      </div>
      <div>
        <span className="label">Ciclo automatico</span>
        <strong>{Math.round((config?.refreshSeconds || DEFAULT_REFRESH_SECONDS) / 60)} min</strong>
      </div>
    </div>
  );
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

function FilterPanel({ filters, onFilterChange, options, dateRange }) {
  const calendarFilterActive = filters.year !== 'Todos' || filters.month !== 'Todos';

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
        <h3>DATA</h3>
        <select value={filters.year} onChange={handleYear}>
          <option value="Todos">Todos</option>
          {options.years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={filters.month} onChange={handleMonth}>
          <option value="Todos">Todos</option>
          {monthNames.map((month, index) => <option value={String(index + 1)} key={month}>{month}</option>)}
        </select>
        <p className="filterHint">
          {calendarFilterActive
            ? 'Ano/mes tem prioridade sobre o periodo manual abaixo.'
            : 'Use o periodo manual abaixo para refinar a faixa de datas.'}
        </p>
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
        <h3>DATA</h3>
        <div className="dateRow">
          <input
            type="date"
            value={filters.startDate || dateRange.start}
            min={dateRange.start}
            max={dateRange.end}
            onChange={handleStartDate}
            disabled={calendarFilterActive}
            title={calendarFilterActive ? 'Limpe ano/mes para usar o periodo manual.' : 'Filtrar data inicial.'}
          />
          <input
            type="date"
            value={filters.endDate || dateRange.end}
            min={dateRange.start}
            max={dateRange.end}
            onChange={handleEndDate}
            disabled={calendarFilterActive}
            title={calendarFilterActive ? 'Limpe ano/mes para usar o periodo manual.' : 'Filtrar data final.'}
          />
        </div>
        <p className="filterHint">Periodo manual aplicado quando ano e mes estiverem em <strong>Todos</strong>.</p>
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
