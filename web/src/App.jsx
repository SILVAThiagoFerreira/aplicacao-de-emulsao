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
import {
  AlertTriangle,
  Database,
  Home,
  KeyRound,
  LogOut,
  RefreshCcw,
  Settings,
  ShieldCheck,
  UploadCloud
} from 'lucide-react';
import sampleDashboard from './data/sampleDashboard.json';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseReady, functions } from './lib/firebase';
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
  const [cache, setCache] = useState(sampleDashboard);
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState({
    sourceUrl: DEFAULT_SOURCE,
    alertEmail: 'thiago.ferreira@enaex.com',
    refreshSeconds: 120
  });
  const [online, setOnline] = useState(firebaseReady);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!firebaseReady || !db) return undefined;
    const unsubscribers = [
      onSnapshot(doc(db, 'dashboard', 'cache'), (snapshot) => {
        if (snapshot.exists()) setCache({ ...snapshot.data(), records: snapshot.data().records || [] });
      }, () => setOnline(false)),
      onSnapshot(doc(db, 'monitor', 'status'), (snapshot) => {
        if (snapshot.exists()) setStatus(snapshot.data());
      }),
      onSnapshot(doc(db, 'app', 'config'), (snapshot) => {
        if (snapshot.exists()) setConfig((old) => ({ ...old, ...snapshot.data() }));
      })
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  return (
    <div className="appShell">
      <Topbar />
      <Sidebar route={route} online={online} />
      <main className="mainCanvas">
        {route.startsWith('#/admin') ? (
          <AdminPage config={config} status={status} cache={cache} />
        ) : (
          <Dashboard cache={cache} status={status} config={config} />
        )}
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
      <div className="topbarRight">Atualização automática online</div>
    </header>
  );
}

function Sidebar({ route, online }) {
  return (
    <aside className="sidebar">
      <a className={route === '#/' ? 'active' : ''} href="#/" title="Dashboard"><Home size={23} /></a>
      <a className={route.startsWith('#/admin') ? 'active' : ''} href="#/admin" title="Admin"><Settings size={22} /></a>
      <span className={`connectionDot ${online ? 'isOnline' : 'isOffline'}`} title={online ? 'Firebase conectado' : 'Modo amostra/local'} />
    </aside>
  );
}

function Dashboard({ cache, status, config }) {
  const records = useMemo(() => cache?.records || [], [cache]);
  const dateRange = useMemo(() => {
    const dates = records.map((item) => item.data).filter(Boolean).sort();
    return { start: dates[0] || '2026-01-01', end: dates[dates.length - 1] || '2026-04-24' };
  }, [records]);
  const [filters, setFilters] = useState({
    poligonoSearch: '',
    poligono: 'Todos',
    umb: 'Todos',
    operador: 'Todos',
    year: 'Todos',
    month: 'Todos',
    ...getCurrentMonthRange()
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
        <StatusStrip cache={cache} status={status} config={config} total={total} />

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
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={18} />
              <YAxis tickFormatter={formatMil} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={68} />
              <Tooltip
                formatter={(value) => formatKg(value)}
                labelFormatter={(_, items) => items?.[0]?.payload ? `Data: ${formatDate(items[0].payload.data)}` : ''}
              />
              <Area dataKey="aplicado" fill="url(#dailyEmulsaoFill)" stroke="none" />
              <Line
                type="monotone"
                dataKey="aplicado"
                name="Aplicado"
                stroke="#e30613"
                strokeWidth={2.6}
                dot={false}
                activeDot={{ r: 5 }}
              />
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

function StatusStrip({ cache, status, config, total }) {
  const failed = status?.state === 'error';
  const sourceState = cache?.sourceState || 'live';
  const isFallback = sourceState !== 'live';
  return (
    <div className={`statusStrip ${failed ? 'hasError' : ''}`}>
      <div>
        <span className="label">Base de dados</span>
        <strong>{firebaseReady ? 'Firebase/Firestore' : 'Amostra local'}</strong>
      </div>
      <div>
        <span className="label">Registros filtrados</span>
        <strong>{total.registros.toLocaleString('pt-BR')}</strong>
      </div>
      <div>
        <span className="label">Última atualização</span>
        <strong>{readTimestamp(cache?.updatedAt) || readTimestamp(status?.lastSuccessAt) || 'Aguardando refresh'}</strong>
      </div>
      <div className="statusMessage">
        {failed ? <AlertTriangle size={16} /> : <Database size={16} />}
        {failed
          ? `Falha: ${status?.lastError || 'sem detalhe'}`
          : isFallback
            ? `Cache em fallback: ${truncate(config?.sourceUrl || '', 52)}`
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

function AdminPage({ config, status, cache }) {
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('emulsaoAdminToken') || '');
  const [isUnlocked, setIsUnlocked] = useState(() => Boolean(sessionStorage.getItem('emulsaoAdminToken')));
  const [form, setForm] = useState({
    token: '',
    sourceUrl: config?.sourceUrl || DEFAULT_SOURCE,
    alertEmail: config?.alertEmail || 'thiago.ferreira@enaex.com',
    alertFrom: config?.alertFrom || '',
    refreshSeconds: config?.refreshSeconds || 120
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm((old) => ({
      ...old,
      sourceUrl: config?.sourceUrl || old.sourceUrl || DEFAULT_SOURCE,
      alertEmail: config?.alertEmail || old.alertEmail || 'thiago.ferreira@enaex.com',
      alertFrom: config?.alertFrom || old.alertFrom || '',
      refreshSeconds: config?.refreshSeconds || old.refreshSeconds || 120
    }));
  }, [config?.sourceUrl, config?.alertEmail, config?.alertFrom, config?.refreshSeconds]);

  const unlockPanel = (event) => {
    event.preventDefault();
    const token = form.token.trim();
    if (!token) {
      setMessage('Informe o token administrativo.');
      return;
    }
    sessionStorage.setItem('emulsaoAdminToken', token);
    setAdminToken(token);
    setIsUnlocked(true);
    setForm((old) => ({ ...old, token: '' }));
    setMessage('Painel administrativo liberado nesta sessão.');
  };

  const lockPanel = () => {
    sessionStorage.removeItem('emulsaoAdminToken');
    setAdminToken('');
    setIsUnlocked(false);
    setMessage('Sessão administrativa encerrada.');
  };

  const saveConfig = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (functions) {
        const updateConfig = httpsCallable(functions, 'updateConfig');
        await updateConfig({
          adminToken,
          sourceUrl: form.sourceUrl.trim(),
          alertEmail: form.alertEmail.trim(),
          alertFrom: form.alertFrom.trim(),
          refreshSeconds: Number(form.refreshSeconds) || 120
        });
        setMessage('Configuração salva.');
      } else {
        setMessage('Firebase Functions não configurado nesta sessão.');
      }
    } catch (error) {
      setMessage(`Não foi possível salvar: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshNow = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (functions) {
        const refreshWorkbook = httpsCallable(functions, 'refreshWorkbook');
        const result = await refreshWorkbook({ manual: true, adminToken });
        setMessage(`Atualização executada: ${result.data?.records || 0} registros.`);
      } else {
        setMessage('Firebase Functions não configurado nesta sessão.');
      }
    } catch (error) {
      setMessage(`Falha ao atualizar: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!firebaseReady) {
    return (
      <div className="adminLayout">
        <div className="panel adminCard">
          <h2>Firebase ainda não configurado</h2>
          <p>Copie <code>web/.env.example</code> para <code>web/.env.local</code> e preencha as chaves do Firebase para ativar banco, funções e monitoramento.</p>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="adminLayout">
        <div className="panel adminCard">
          <div className="adminIcon"><KeyRound size={28} /></div>
          <h2>Acesso administrativo</h2>
          <p>Este projeto não usa Firebase Authentication. O acesso ao painel é feito por token secreto salvo no Firebase Functions Secret Manager.</p>
          <form onSubmit={unlockPanel} className="adminForm">
            <input
              value={form.token}
              onChange={(event) => setForm({ ...form, token: event.target.value })}
              placeholder="token administrativo"
              type="password"
              autoComplete="current-password"
            />
            <button disabled={busy}>Entrar no painel</button>
          </form>
          <div className="warningBox">
            <AlertTriangle size={18} />
            Configure o token com <code>firebase functions:secrets:set ADMIN_PANEL_TOKEN</code> antes de publicar as funções.
          </div>
          {message && <p className="message">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="adminLayout">
      <div className="panel adminCard wide">
        <div className="adminHeader">
          <div>
            <span className="eyebrow">Administrador</span>
            <h2>Painel de configuração</h2>
            <p>Acesso por token administrativo. Sem Firebase Authentication.</p>
          </div>
          <button className="secondaryButton" onClick={lockPanel}><LogOut size={16} /> Sair</button>
        </div>

        <form onSubmit={saveConfig} className="adminForm configForm">
          <label>Link da planilha OneDrive/SharePoint</label>
          <textarea value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} rows={4} />
          <div className="twoColumns">
            <label>Email de alerta
              <input value={form.alertEmail} onChange={(event) => setForm({ ...form, alertEmail: event.target.value })} type="email" />
            </label>
            <label>Remetente SendGrid verificado
              <input value={form.alertFrom} onChange={(event) => setForm({ ...form, alertFrom: event.target.value })} placeholder="alertas@seudominio.com" />
            </label>
            <label>Intervalo em segundos
              <input value={form.refreshSeconds} onChange={(event) => setForm({ ...form, refreshSeconds: event.target.value })} type="number" min="60" step="30" />
            </label>
          </div>
          <div className="buttonRow">
            <button disabled={busy}><UploadCloud size={16} /> Salvar configuração</button>
            <button type="button" className="secondaryButton" disabled={busy} onClick={refreshNow}><RefreshCcw size={16} /> Atualizar agora</button>
          </div>
        </form>

        <div className="adminStatusGrid">
          <div><span>Última leitura</span><strong>{readTimestamp(cache?.updatedAt) || 'Sem cache'}</strong></div>
          <div><span>Status</span><strong>{status?.state || 'sem status'}</strong></div>
          <div><span>Erro</span><strong>{status?.lastError || 'nenhum'}</strong></div>
          <div><span>Registros</span><strong>{cache?.records?.length || 0}</strong></div>
        </div>
        {message && <p className="message">{message}</p>}
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

function truncate(text, length) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

export default App;
