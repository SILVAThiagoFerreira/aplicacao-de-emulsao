export const monthNames = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatKg(value) {
  return `${toNumber(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
}

export function formatMil(value) {
  const number = toNumber(value) / 1000;
  return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} Mil`;
}

export function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function getMonthKey(dateString) {
  const date = String(dateString || '').slice(0, 10);
  return date.length >= 7 ? date.slice(0, 7) : 'sem-data';
}

export function getYear(dateString) {
  const year = Number(String(dateString || '').slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function monthLabelFromKey(key) {
  const month = Number(String(key || '').slice(5, 7));
  return monthNames[month - 1] || key;
}
