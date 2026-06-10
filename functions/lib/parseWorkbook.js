const XLSX = require('xlsx');

function parseWorkbookToDashboard(buffer, { sourceUrl = '', finalUrl = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const records = parseWorkbook(workbook);
  return {
    sourceUrl,
    finalUrl,
    sourceState: 'live',
    records,
    ritmo: [],
    totals: records.reduce((acc, item) => {
      acc.emulsao += toNumber(item.emulsao);
      acc.furos += toNumber(item.furos);
      return acc;
    }, { emulsao: 0, furos: 0 })
  };
}

function parseWorkbook(workbook) {
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const indexed = indexHeaders(headers);
  const records = [];
  for (const row of rows.slice(1)) {
    const record = {
      data: readCell(row, indexed.data),
      poligono: readCell(row, indexed.poligono),
      emulsao: toNumber(readCell(row, indexed.emulsao)),
      furos: toNumber(readCell(row, indexed.furos)),
      umb: readCell(row, indexed.umb),
      operador: readCell(row, indexed.operador)
    };
    if (!record.data || (!record.poligono && !record.emulsao && !record.furos)) continue;
    record.data = normalizeDate(record.data);
    record.mediaKgFuro = record.furos ? record.emulsao / record.furos : 0;
    records.push(record);
  }
  return records;
}

function indexHeaders(headers) {
  const lookup = (names) => headers.findIndex((header) => names.includes(header));
  return {
    data: lookup(['data', 'dt', 'date', 'dia']),
    poligono: lookup(['poligono', 'polígono', 'bloco', 'nomepoligono']),
    emulsao: lookup(['emulsao', 'emulsão', 'kgemulsao', 'aplicado', 'peso']),
    furos: lookup(['furos', 'furo', 'quantidadefuros']),
    umb: lookup(['umb']),
    operador: lookup(['operador', 'nomeoperador', 'responsavel'])
  };
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function readCell(row, index) {
  if (index < 0) return '';
  return row[index] ?? '';
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(text)) {
    const [day, month, year] = text.slice(0, 10).split('/');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return text.slice(0, 10);
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value || '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

module.exports = { parseWorkbookToDashboard };
