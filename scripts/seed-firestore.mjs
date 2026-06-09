import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID || 'aplicacao-de-emulsao';
const sourceUrl = process.env.SOURCE_URL || 'https://empresassk-my.sharepoint.com/:x:/g/personal/jose_queiroz_enaex_com/IQBOjdbs_K8tTKIXFm3nd_9LAU30PI_479TJVck9e61RHSQ?e=x49ktL';
const alertEmail = process.env.ALERT_EMAIL || 'thiago.ferreira@enaex.com';
const alertFrom = process.env.ALERT_FROM || '';

admin.initializeApp({ projectId });
const db = admin.firestore();

await db.doc('app/config').set({
  sourceUrl,
  alertEmail,
  alertFrom,
  refreshSeconds: 120,
  seededAt: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true });

console.log('Configuração inicial criada em app/config.');
console.log('Este pacote não usa Firebase Authentication. O acesso admin usa ADMIN_PANEL_TOKEN nas Cloud Functions.');
