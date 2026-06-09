import { formatDate, getMonthKey, getYear, monthLabelFromKey, toNumber } from './format';

export function uniqueValues(records, field) {
  return Array.from(new Set(records.map((item) => item[field]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

export function applyFilters(records, filters) {
  const start = filters.startDate || '';
  const end = filters.endDate || '';
  const poligonoSearch = filters.poligonoSearch?.trim().toLowerCase() || '';
  return records.filter((item) => {
    const data = String(item.data || '').slice(0, 10);
    if (start && data < start) return false;
    if (end && data > end) return false;
    if (filters.year !== 'Todos' && getYear(data) !== Number(filters.year)) return false;
    if (filters.month !== 'Todos' && Number(data.slice(5, 7)) !== Number(filters.month)) return false;
    if (filters.poligono !== 'Todos' && item.poligono !== filters.poligono) return false;
    if (filters.umb !== 'Todos' && String(item.umb) !== String(filters.umb)) return false;
    if (filters.operador !== 'Todos' && item.operador !== filters.operador) return false;
    if (poligonoSearch && !String(item.poligono || '').toLowerCase().includes(poligonoSearch)) return false;
    return true;
  });
}

export function buildDailyTable(records) {
  const map = new Map();
  records.forEach((item) => {
    const key = `${item.data}|${item.poligono}`;
    const previous = map.get(key) || { data: item.data, poligono: item.poligono, emulsao: 0, furos: 0 };
    previous.emulsao += toNumber(item.emulsao);
    previous.furos += toNumber(item.furos);
    map.set(key, previous);
  });
  return Array.from(map.values())
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))
    .map((item) => ({ ...item, mediaKgFuro: item.furos ? item.emulsao / item.furos : 0 }));
}

export function buildDailyTrend(records) {
  const map = new Map();
  records.forEach((item) => {
    const data = String(item.data || '').slice(0, 10);
    if (!data) return;
    const previous = map.get(data) || { data, dia: formatDate(data), aplicado: 0, furos: 0 };
    previous.aplicado += toNumber(item.emulsao);
    previous.furos += toNumber(item.furos);
    map.set(data, previous);
  });
  return Array.from(map.values()).sort((a, b) => a.data.localeCompare(b.data));
}

export function buildMonthly(records) {
  const map = new Map();
  records.forEach((item) => {
    const key = getMonthKey(item.data);
    const previous = map.get(key) || { key, mes: monthLabelFromKey(key), aplicado: 0, furos: 0 };
    previous.aplicado += toNumber(item.emulsao);
    previous.furos += toNumber(item.furos);
    map.set(key, previous);
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function buildMonthlyByUmb(records) {
  const map = new Map();
  records.forEach((item) => {
    const key = `${getMonthKey(item.data)}|${item.umb || 'Sem UMB'}`;
    const previous = map.get(key) || { key, monthKey: getMonthKey(item.data), mes: monthLabelFromKey(getMonthKey(item.data)), umb: String(item.umb || 'Sem UMB'), aplicado: 0 };
    previous.aplicado += toNumber(item.emulsao);
    map.set(key, previous);
  });
  return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.umb.localeCompare(b.umb));
}

export function buildProjection(records, ritmoFromCache = []) {
  const monthly = buildMonthly(records);
  const appliedTotal = monthly.reduce((sum, item) => sum + item.aplicado, 0);
  const rhythmTotal = ritmoFromCache
    .filter((item) => monthly.some((month) => month.key === `${item.ano}-${String(item.mesNumero).padStart(2, '0')}`))
    .reduce((sum, item) => sum + toNumber(item.ritmo || item.aplicado), 0);
  return [
    { name: 'Ritmo', value: rhythmTotal || appliedTotal },
    { name: 'Aplicado', value: appliedTotal }
  ];
}

export function totals(records) {
  return records.reduce((acc, item) => {
    acc.emulsao += toNumber(item.emulsao);
    acc.furos += toNumber(item.furos);
    acc.registros += 1;
    return acc;
  }, { emulsao: 0, furos: 0, registros: 0 });
}
