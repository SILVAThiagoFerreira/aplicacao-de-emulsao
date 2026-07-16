import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';

const require = createRequire(import.meta.url);
const { parseWorkbookToDashboard } = require('../functions/lib/parseWorkbook.js');

const SOURCE_URL = process.env.SOURCE_URL || 'https://docs.google.com/spreadsheets/d/1OGBE4wurFr0ZdsrU57dxPDF2M7IYwaLL/edit?usp=sharing&ouid=106130974941027428781&rtpof=true&sd=true';
const SOURCE_FILE = process.env.SOURCE_FILE || '';
const outputPath = path.resolve('web/public/dashboard-cache.json');
const firestoreOutputPath = process.env.FIRESTORE_OUTPUT_PATH || 'dashboard/cache';

const allowFallback = String(process.env.ALLOW_FALLBACK_SAMPLE || '').toLowerCase() === 'true';
let dashboard;
try {
  const buffer = SOURCE_FILE ? await fs.readFile(SOURCE_FILE) : await fetchWorkbookBuffer(SOURCE_URL);
  dashboard = parseWorkbookToDashboard(buffer, { sourceUrl: SOURCE_URL, finalUrl: SOURCE_URL });
  dashboard.updatedAt = new Date().toISOString();
  dashboard.source = SOURCE_URL;
} catch (error) {
  if (!allowFallback) {
    throw new Error(`Falha ao atualizar o dashboard a partir da planilha de origem: ${error.message}`);
  }
  const sampleDashboard = require('../web/src/data/sampleDashboard.json');
  dashboard = {
    updatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    finalUrl: SOURCE_URL,
    sourceState: 'fallback',
    records: Array.isArray(sampleDashboard.records) ? sampleDashboard.records : [],
    ritmo: Array.isArray(sampleDashboard.ritmo) ? sampleDashboard.ritmo : [],
    justificativas: Array.isArray(sampleDashboard.justificativas) ? sampleDashboard.justificativas : [],
    totals: sampleDashboard.totals || { emulsao: 0, furos: 0 }
  };
  console.warn(`Falha ao ler a planilha; usando fallback local porque ALLOW_FALLBACK_SAMPLE=true: ${error.message}`);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');

await writeToFirestore(dashboard, firestoreOutputPath);

console.log(`Dashboard cache atualizado: ${dashboard.records.length} registros em ${outputPath}`);

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
  add(toGoogleSheetsExportUrl(sourceUrl));
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

function toGoogleSheetsExportUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (!url.hostname.includes('docs.google.com')) return sourceUrl;
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return sourceUrl;
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
  } catch (_) {
    return sourceUrl;
  }
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

async function writeToFirestore(dashboard, docPath) {
  const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'aplicacao-de-emulsao';
  if (!credentialsJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON ausente; a atualização não pode ser confirmada.');
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
