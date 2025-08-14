// set-admin.js (local script)
const admin = require('firebase-admin');

if (!process.env.SA_PATH) {
  console.error('Set SA_PATH env var to the service-account json path. Example: SA_PATH=./serviceAccountKey.json node set-admin.js <uid>');
  process.exit(1);
}

const serviceAccount = require(process.env.SA_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: SA_PATH=./serviceAccountKey.json node set-admin.js <uid>');
  process.exit(1);
}

(async () => {
  try {
    await admin.auth().setCustomUserClaims(uid, { ...( (await admin.auth().getUser(uid)).customClaims || {} ), admin: true });
    console.log(`Set admin claim for ${uid}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to set admin claim:', err);
    process.exit(1);
  }
})();
