import { useEffect, useMemo, useState } from 'react';
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
import { AlertTriangle, Database, Home } from 'lucide-react';
import {
  applyFilters,
  buildDailyTable,
  buildDailyTrend,
  buildMonthly,
  buildMonthlyByUmb,
  buildProjection,
  totals,
  uniqueValues
} from './lib/aggregate';
import { formatDate, formatKg, formatMil, monthNames } from './lib/format';

const DEFAULT_SOURCE = 'https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit?usp=sharing&ouid=106130974941027428781&rtpof=true&sd=true';
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
  const pad = (value) => String(value).padStart(2, '0');
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
      <div className="topbarRight">Atualiza automaticamente no GitHub Pages</div>
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

  for (let item = 1; item <= 4; item += 1) {
    indexes.add(Math.round((item * lastIndex) / 5));
  }

  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => rows[index]?.dia)
    .filter(Boolean);
}

function Dashboard({ cache, status, config }) {
  const records = useMemo(() => cache?.records || [], [cache]);
  const dateRange = useMemo(() => {
    const dates = records.map((item) => item.data).filter(Boolean).sort();
    return { start: dates[0] || '2026-01-01', end: dates[dates.length - 1] || '2026-04-24' };
  }, [records]);
  const currentMonth = useMemo(() => getCurrentMonthRange(), []);
  const [filters, setFilters] = useState({
    poligonoSearch: '',
    poligono: 'Todos',
    umb: 'Todos',
    operador: 'Todos',
    year: 'Todos',
    month: 'Todos',
    startDate: currentMonth.start,
    endDate: currentMonth.end
  });

  useEffect(() => {
    setFilters((old) => ({
      ...old,
      startDate: old.startDate || getCurrentMonthRange().start,
      endDate: old.endDate || getCurrentMonthRange().end
    }));
  }, [dateRange.start, dateRange.end]);

  const filtered = useMemo(() => applyFilters(records, filters), [records, filters]);
  const dailyRows = useMemo(() => buildDailyTable(filtered), [filtered]);
  const dailyTrend = useMemo(() => buildDailyTrend(filtered), [filtered]);
  const dailyTicks = useMemo(() => getDateTicks(dailyTrend), [dailyTrend]);
  const latestApplication = dailyTrend.length ? dailyTrend[dailyTrend.length - 1].data : '';
  const monthly = useMemo(() => buildMonthly(filtered), [filtered]);
  const monthlyByUmb = useMemo(() => buildMonthlyByUmb(filtered), [filtered]);
  const projection = useMemo(() => buildProjection(filtered, cache.ritmo || []), [filtered, cache.ritmo]);
  const total = useMemo(() => totals(filtered), [filtered]);

  const options = useMemo(() => ({
    poligonos: uniqueValues(records, 'poligono'),
    umbs: uniqueValues(records, 'umb'),
    operadores: uniqueValues(records, 'operador'),
    years: Array.from(new Set(records.map((item) => String(item.data || '').slice(0, 4)).filter(Boolean))).sort()
  }), [records]);

  return (
    <div className="dashboardGrid">
      <section className="leftPanel">
        <DailyPanel rows={dailyRows} total={total} />
        <FilterPanel filters={filters} setFilters={setFilters} options={options} dateRange={dateRange} />
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
              <Tooltip formatter={(value) => formatKg(value)} labelFormatter={(_, items) => items?.[0]?.payload ? `Data: ${formatDate(items[0].payload.data)}` : ''} />
              <Area dataKey="aplicado" fill="url(#dailyEmulsaoFill)" stroke="none" />
              <Line type="monotone" dataKey="aplicado" name="Aplicado" stroke="#e30613" strokeWidth={2.6} dot={false} activeDot={{ r: 5 }} />
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
              <Tooltip formatter={(value) => formatKg(value)} labelFormatter={(label) => `Mês: ${label}`} />
              <Area dataKey="aplicado" fill="url(#emulsaoFill)" stroke="none" />
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
              <Tooltip formatter={(value) => formatKg(value)} labelFormatter={(_, items) => items?.[0]?.payload ? `${items[0].payload.mes} | UMB ${items[0].payload.umb}` : ''} />
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
              <Tooltip formatter={(value) => formatKg(value)} />
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
  const sourceState = cache?.sourceState || 'live';
  const isFallback = sourceState !== 'live';
  return (
    <div className={`statusStrip ${failed ? 'hasError' : ''}`}>
      <div>
        <span className="label">Base de dados</span>
        <strong>Google Sheets + GitHub Pages</strong>
      </div>
      <div>
        <span className="label">Registros filtrados</span>
        <strong>{total.registros.toLocaleString('pt-BR')}</strong>
      </div>
      <div>
        <span className="label">Última aplicação</span>
        <strong>{formatDate(latestApplication) || '-'}</strong>
      </div>
      <div>
        <span className="label">Última atualização</span>
        <strong>{readTimestamp(cache?.updatedAt) || readTimestamp(status?.lastSuccessAt) || 'Aguardando refresh'}</strong>
      </div>
      <div>
        <span className="label">Ciclo automático</span>
        <strong>{Math.round((config?.refreshSeconds || DEFAULT_REFRESH_SECONDS) / 60)} min</strong>
      </div>
      <div className="statusMessage">
        {failed ? <AlertTriangle size={16} /> : <Database size={16} />}
        {failed
          ? `Falha: ${status?.lastError || 'sem detalhe'}`
          : isFallback
            ? `Cache estático: ${truncate(config?.sourceUrl || '', 52)}`
            : `Fonte: ${truncate(config?.sourceUrl || '', 52)}`}
      </div>
    </div>
  );
}

function DailyPanel({ rows, total }) {
  return (
    <div className="panel dailyPanel">
      <h2>DEMONSTRATIVO DIÁRIO</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Polígono</th>
              <th>Soma de Emulsão</th>
              <th>Soma de Furos</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 18).map((row) => (
              <tr key={`${row.data}-${row.poligono}`}>
                <td>{formatDate(row.data)}</td>
                <td>{row.poligono}</td>
                <td>{row.emulsao.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                <td>{row.furos.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
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

function FilterPanel({ filters, setFilters, options, dateRange }) {
  const update = (field, value) => setFilters((old) => ({ ...old, [field]: value }));
  return (
    <div className="filtersGrid">
      <div className="panel filterBox span2">
        <h3>POLÍGONO</h3>
        <input value={filters.poligonoSearch} onChange={(event) => update('poligonoSearch', event.target.value)} placeholder="Search" />
        <select value={filters.poligono} onChange={(event) => update('poligono', event.target.value)}>
          <option>Todos</option>
          {options.poligonos.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>DATA</h3>
        <select value={filters.year} onChange={(event) => update('year', event.target.value)}>
          <option>Todos</option>
          {options.years.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={filters.month} onChange={(event) => update('month', event.target.value)}>
          <option>Todos</option>
          {monthNames.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>UMB</h3>
        <select value={filters.umb} onChange={(event) => update('umb', event.target.value)}>
          <option>Todos</option>
          {options.umbs.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox">
        <h3>OPERADOR</h3>
        <select value={filters.operador} onChange={(event) => update('operador', event.target.value)}>
          <option>Todos</option>
          {options.operadores.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="panel filterBox span2">
        <h3>DATA</h3>
        <div className="dateRow">
          <input type="date" value={filters.startDate || dateRange.start} min={dateRange.start} max={dateRange.end} onChange={(event) => update('startDate', event.target.value)} />
          <input type="date" value={filters.endDate || dateRange.end} min={dateRange.start} max={dateRange.end} onChange={(event) => update('endDate', event.target.value)} />
        </div>
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

function readTimestamp(value) {
  if (!value) return '';
  if (value?.toDate) return value.toDate().toLocaleString('pt-BR');
  if (typeof value === 'string') return new Date(value).toLocaleString('pt-BR');
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString('pt-BR');
  return '';
}

function truncate(text, length) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

export default App;
