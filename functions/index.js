const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { parseWorkbookToDashboard } = require('./lib/parseWorkbook');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 4, timeoutSeconds: 120, memory: '512MiB' });

const db = admin.firestore();
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');
const SENDGRID_FROM = defineSecret('SENDGRID_FROM');
const ADMIN_PANEL_TOKEN = defineSecret('ADMIN_PANEL_TOKEN');
const DEFAULT_SOURCE = 'https://empresassk-my.sharepoint.com/:x:/g/personal/jose_queiroz_enaex_com/IQBOjdbs_K8tTKIXFm3nd_9LAU30PI_479TJVck9e61RHSQ?e=x49ktL';
const DEFAULT_ALERT_EMAIL = 'thiago.ferreira@enaex.com';

exports.refreshWorkbook = onCall({ secrets: [SENDGRID_API_KEY, SENDGRID_FROM, ADMIN_PANEL_TOKEN] }, async (request) => {
  assertAdminToken(request.data?.adminToken);
  const result = await runRefresh({ manualBy: 'admin-token' });
  return { ok: true, records: result.records, updatedAt: result.updatedAt };
});

exports.updateConfig = onCall({ secrets: [ADMIN_PANEL_TOKEN] }, async (request) => {
  assertAdminToken(request.data?.adminToken);
  const data = request.data || {};
  const sourceUrl = String(data.sourceUrl || '').trim();
  const alertEmail = String(data.alertEmail || DEFAULT_ALERT_EMAIL).trim();
  const alertFrom = String(data.alertFrom || '').trim();
  const refreshSeconds = Number(data.refreshSeconds || 120);

  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    throw new HttpsError('invalid-argument', 'Informe um link válido da planilha.');
  }

  await db.doc('app/config').set({
    sourceUrl,
    alertEmail,
    alertFrom,
    refreshSeconds: Number.isFinite(refreshSeconds) ? refreshSeconds : 120,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'admin-token'
  }, { merge: true });

  return { ok: true };
});


exports.scheduledWorkbookMonitor = onSchedule({
  schedule: 'every 2 minutes',
  timeZone: 'America/Sao_Paulo',
  secrets: [SENDGRID_API_KEY, SENDGRID_FROM]
}, async () => {
  await runRefresh({ manualBy: 'scheduler' });
});

function assertAdminToken(token) {
  const expected = ADMIN_PANEL_TOKEN.value();
  if (!expected) {
    throw new HttpsError('failed-precondition', 'ADMIN_PANEL_TOKEN não foi configurado no Firebase Functions.');
  }
  if (!token || token !== expected) {
    throw new HttpsError('permission-denied', 'Token administrativo inválido.');
  }
}

async function getConfig() {
  const snapshot = await db.doc('app/config').get();
  return {
    sourceUrl: DEFAULT_SOURCE,
    alertEmail: DEFAULT_ALERT_EMAIL,
    refreshSeconds: 120,
    alertFrom: '',
    ...(snapshot.exists ? snapshot.data() : {})
  };
}

async function runRefresh({ manualBy }) {
  const config = await getConfig();
  const startedAt = new Date();
  try {
    const { buffer, finalUrl } = await fetchWorkbookBuffer(config.sourceUrl);
    const dashboard = parseWorkbookToDashboard(buffer, { sourceUrl: config.sourceUrl, finalUrl });
    await db.doc('dashboard/cache').set({
      ...dashboard,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: manualBy,
      sourceUrl: config.sourceUrl,
      finalUrl
    }, { merge: false });
    await db.doc('monitor/status').set({
      state: 'ok',
      lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStartedAt: startedAt.toISOString(),
      lastError: null,
      consecutiveFailures: 0,
      checkedBy: manualBy
    }, { merge: true });
    return { records: dashboard.records.length, updatedAt: new Date().toISOString() };
  } catch (error) {
    await recordFailureAndAlert(config, error, manualBy);
    throw error;
  }
}

async function fetchWorkbookBuffer(sourceUrl) {
  const candidates = makeDownloadCandidates(sourceUrl);
  const errors = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
          'User-Agent': 'Enaex-Emulsao-Dashboard/1.0'
        }
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!looksLikeZip(buffer)) {
        const start = buffer.toString('utf8', 0, Math.min(buffer.length, 220)).replace(/\s+/g, ' ');
        throw new Error(`Resposta não parece XLSX. Content-Type: ${contentType}. Início: ${start}`);
      }
      return { buffer, finalUrl: url };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`Não foi possível acessar a planilha. Tentativas: ${errors.join(' | ')}`);
}

function looksLikeZip(buffer) {
  return buffer && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
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
    // ignora URL inválida para manter erro original no fetch
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

async function recordFailureAndAlert(config, error, checkedBy) {
  const statusRef = db.doc('monitor/status');
  const previous = await statusRef.get();
  const previousData = previous.exists ? previous.data() : {};
  const consecutiveFailures = Number(previousData.consecutiveFailures || 0) + 1;
  const now = Date.now();
  const lastEmailAt = previousData.lastEmailAt?.toMillis?.() || 0;
  let emailResult = { sent: false, reason: 'janela de silêncio ativa' };
  if (!lastEmailAt || now - lastEmailAt > 30 * 60 * 1000) {
    emailResult = await sendAlertEmail(config, error, consecutiveFailures);
  }
  await statusRef.set({
    state: 'error',
    lastError: error.message,
    lastFailureAt: admin.firestore.FieldValue.serverTimestamp(),
    consecutiveFailures,
    checkedBy,
    lastEmailAt: emailResult.sent ? admin.firestore.FieldValue.serverTimestamp() : previousData.lastEmailAt || null,
    lastEmailResult: emailResult
  }, { merge: true });
}

async function sendAlertEmail(config, error, consecutiveFailures) {
  const apiKey = SENDGRID_API_KEY.value();
  const from = config.alertFrom || SENDGRID_FROM.value();
  const to = config.alertEmail || DEFAULT_ALERT_EMAIL;
  if (!apiKey || !from || !to) {
    return { sent: false, reason: 'SENDGRID_API_KEY, SENDGRID_FROM ou alertEmail ausente' };
  }
  sgMail.setApiKey(apiKey);
  await sgMail.send({
    to,
    from,
    subject: 'Falha de atualização | Dashboard de Emulsão',
    text: [
      'O sistema não conseguiu acessar ou atualizar a planilha do Dashboard de Emulsão.',
      '',
      `Falhas consecutivas: ${consecutiveFailures}`,
      `Link configurado: ${config.sourceUrl}`,
      `Erro: ${error.message}`,
      '',
      'Acesse o painel administrativo para corrigir o link ou verificar permissões da planilha.'
    ].join('\n')
  });
  return { sent: true, to, at: new Date().toISOString() };
}
