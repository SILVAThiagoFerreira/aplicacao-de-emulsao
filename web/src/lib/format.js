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

// Eixo em kg: abaixo de 1.000 kg mostra kg, para que ticks pequenos não virem "1 Mil" repetido.
export function formatAxisKg(value) {
  const number = toNumber(value);
  if (Math.abs(number) < 1000) return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`;
  const thousands = number / 1000;
  return `${thousands.toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(thousands) ? 0 : 1 })} Mil`;
}

export function formatCompactPlanKg(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (Math.abs(amount) < 1000) return amount.toLocaleString('pt-BR');
  const thousands = (amount / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return `${thousands}k`;
}

export function formatPlanWaterfallTick(value) {
  if (value === 'Total') return value;
  const [day, month] = String(value || '').split('/');
  return day && month ? `${day}/${month}` : value;
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
