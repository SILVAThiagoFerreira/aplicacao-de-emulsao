import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const sampleDashboard = require('../web/src/data/sampleDashboard.json');

const SOURCE_URL = process.env.SOURCE_URL || 'https://empresassk-my.sharepoint.com/:x:/g/personal/jose_queiroz_enaex_com/IQBOjdbs_K8tTKIXFm3nd_9LAUp1C8FrYgMroBbug01U3A4?e=whRgaf';
const SOURCE_FILE = process.env.SOURCE_FILE || '';
const outputPath = path.resolve('web/public/dashboard-cache.json');
const firestoreOutputPath = process.env.FIRESTORE_OUTPUT_PATH || 'dashboard/cache';

let sourceState = 'live';
let records = [];
try {
  const buffer = SOURCE_FILE ? await fs.readFile(SOURCE_FILE) : await fetchWorkbookBuffer(SOURCE_URL);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  records = parseWorkbook(workbook);
} catch (error) {
  sourceState = 'fallback';
  records = Array.isArray(sampleDashboard.records) ? sampleDashboard.records : [];
  console.warn(`Falha ao ler a planilha; usando fallback local: ${error.message}`);
}
const dashboard = {
  updatedAt: new Date().toISOString(),
  source: SOURCE_URL,
  sourceState,
  records,
  ritmo: [],
  totals: records.reduce((acc, item) => {
    acc.emulsao += toNumber(item.emulsao);
    acc.furos += toNumber(item.furos);
    return acc;
  }, { emulsao: 0, furos: 0 })
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');

await writeToFirestore(dashboard, firestoreOutputPath);

console.log(`Dashboard cache atualizado: ${records.length} registros em ${outputPath}`);

async function fetchWorkbookBuffer(sourceUrl) {
  const candidates = makeDownloadCandidates(sourceUrl);
  const errors = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
          'User-Agent': 'Enaex-Emulsao-GitHubActions/1.0'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        const head = buffer.toString('utf8', 0, Math.min(buffer.length, 200)).replace(/\s+/g, ' ');
        throw new Error(`Resposta não parece XLSX. Início: ${head}`);
      }
      return buffer;
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Não foi possível baixar a planilha. ${errors.join(' | ')}`);
}

function makeDownloadCandidates(sourceUrl) {
  const urls = [];
  const add = (candidate) => {
    if (candidate && !urls.includes(candidate)) urls.push(candidate);
  };
  add(addDownloadParam(sourceUrl));
  add(sourceUrl);
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('download', '1');
    url.searchParams.delete('web');
    add(url.toString());
  } catch (_) {
    // mantém o erro original do fetch
  }
  return urls;
}

function addDownloadParam(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set('download', '1');
    return url.toString();
  } catch (_) {
    return sourceUrl;
  }
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

async function writeToFirestore(dashboard, docPath) {
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'aplicacao-de-emulsao';
  if (!credentialsJson) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON ausente; pulando gravação no Firestore.');
    return;
  }
  if (!admin.apps.length) {
    const credential = admin.credential.cert(JSON.parse(credentialsJson));
    admin.initializeApp({ credential, projectId });
  }
  const db = admin.firestore();
  await db.doc(docPath).set({
    ...dashboard,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'github-actions'
  }, { merge: false });
}
