const XLSX = require('xlsx');

function parseWorkbookToDashboard(buffer, { sourceUrl = '', finalUrl = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const records = parseWorkbook(workbook);
  const ritmo = parseRitmo(workbook);
  const metas = parseMetas(workbook);
  const justificativas = parseJustificativas(workbook);
  return {
    sourceUrl,
    finalUrl,
    sourceState: 'live',
    records,
    ritmo,
    metas,
    justificativas,
    totals: records.reduce((acc, item) => {
      acc.emulsao += toNumber(item.emulsao);
      acc.furos += toNumber(item.furos);
      return acc;
    }, { emulsao: 0, furos: 0 })
  };
}

function parseJustificativas(workbook) {
  const sheetName = findSheetNameWithHeaders(workbook, ['justificativa', 'justificativas'], ['data', 'motivo']);
  if (!sheetName) return [];
  const rows = readSheetRows(workbook, sheetName);
  const headerIndex = findHeaderRow(rows, ['data', 'motivo']);
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(normalizeHeader);
  const lookup = (names) => headers.findIndex((header) => names.some((name) => header.includes(normalizeHeader(name))));
  const indexes = {
    data: lookup(['data', 'dia', 'date']),
    poligono: lookup(['poligono', 'bloco', 'nomepoligono']),
    motivo: lookup(['motivo', 'justificativa', 'justificativas', 'razao', 'observacao', 'observacoes'])
  };

  return rows.slice(headerIndex + 1).map((row) => ({
    data: normalizeDate(readCell(row, indexes.data)),
    poligono: String(readCell(row, indexes.poligono) || '').trim(),
    motivo: String(readCell(row, indexes.motivo) || '').trim()
  })).filter((item) => item.data && item.motivo);
}

function parseWorkbook(workbook) {
  const sheetName = findSheetName(workbook, ['entrada', 'dados', 'base']) || workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = readSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const headerIndex = findHeaderRow(rows, ['data', 'poligono', 'emulsao']);
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(normalizeHeader);
  const indexed = indexHeaders(headers);
  const records = [];
  for (const row of rows.slice(headerIndex + 1)) {
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

function parseRitmo(workbook) {
  const sheetName = findSheetNameWithHeaders(workbook, ['ritmo', 'projecao'], ['ano', 'mes', 'ritmo'])
    || findSheetNameWithHeaders(workbook, ['meta'], ['ano', 'mes', 'ritmo']);
  if (!sheetName) return [];
  const rows = readSheetRows(workbook, sheetName);
  const headerIndex = findHeaderRow(rows, ['ano', 'mes', 'ritmo']);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(normalizeHeader);
  const lookup = (names) => headers.findIndex((header) => names.includes(header));
  const indexes = {
    ano: lookup(['ano', 'year']),
    mes: lookup(['mes', 'mês', 'month']),
    meta: lookup(['meta', 'objetivo']),
    ritmo: lookup(['ritmo']),
    aplicado: lookup(['aplicado', 'realizado'])
  };

  return rows.slice(headerIndex + 1).map((row) => {
    const ano = toNumber(readCell(row, indexes.ano));
    const mesRaw = readCell(row, indexes.mes);
    const mesNumero = normalizeMonth(mesRaw);
    return {
      ano,
      mes: String(mesRaw || ''),
      mesNumero,
      meta: toNumber(readCell(row, indexes.meta)),
      ritmo: toNumber(readCell(row, indexes.ritmo)),
      aplicado: toNumber(readCell(row, indexes.aplicado))
    };
  }).filter((item) => item.ano && item.mesNumero);
}

function parseMetas(workbook) {
  const sheetName = findSheetNameWithHeaders(workbook, ['meta'], ['data', 'meta']);
  if (!sheetName) return [];
  const rows = readSheetRows(workbook, sheetName);
  const headerIndex = findHeaderRow(rows, ['data', 'meta']);
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(normalizeHeader);
  const lookup = (names) => headers.findIndex((header) => names.some((name) => header.includes(normalizeHeader(name))));
  const indexes = {
    data: lookup(['data', 'dia', 'date']),
    meta: lookup(['meta', 'objetivo', 'planejado', 'kg'])
  };

  return rows.slice(headerIndex + 1).map((row) => {
    const data = normalizeDate(readCell(row, indexes.data));
    return {
      data,
      meta: toNumber(readCell(row, indexes.meta))
    };
  }).filter((item) => item.data && item.meta);
}

function findSheetName(workbook, tokens) {
  return workbook.SheetNames.find((name) => {
    const normalized = normalizeHeader(name);
    return tokens.some((token) => normalized.includes(normalizeHeader(token)));
  });
}

function findSheetNameWithHeaders(workbook, tokens, requiredTerms) {
  return workbook.SheetNames.find((name) => {
    const normalized = normalizeHeader(name);
    if (!tokens.some((token) => normalized.includes(normalizeHeader(token)))) return false;
    const rows = readSheetRows(workbook, name);
    return findHeaderRow(rows, requiredTerms) >= 0;
  });
}

function readSheetRows(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
}

function findHeaderRow(rows, requiredTerms) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return requiredTerms.every((term) => normalized.some((header) => header.includes(normalizeHeader(term))));
  });
}

function indexHeaders(headers) {
  const lookup = (names) => headers.findIndex((header) => names.includes(header));
  return {
    data: lookup(['data', 'dt', 'date', 'dia']),
    poligono: lookup(['poligono', 'bloco', 'nomepoligono']),
    emulsao: lookup(['emulsao', 'kgemulsao', 'aplicado', 'peso']),
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToDate(value);
  }
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

function excelSerialToDate(serial) {
  const excelEpoch = Date.UTC(1899, 11, 30);
  const milliseconds = Math.round(serial * 24 * 60 * 60 * 1000);
  const date = new Date(excelEpoch + milliseconds);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return String(serial);
}

function normalizeMonth(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.round(value), 1), 12);
  }
  const normalized = normalizeHeader(value);
  const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const index = months.findIndex((month) => normalized === month || normalized.startsWith(month.slice(0, 3)));
  if (index >= 0) return index + 1;
  const numeric = toNumber(value);
  return numeric ? Math.min(Math.max(Math.round(numeric), 1), 12) : 0;
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
