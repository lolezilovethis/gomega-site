// setAdmin.js
const admin = require('firebase-admin');
const email = process.argv[2];

if (!email) {
  console.error('Usage: node setAdmin.js admin@example.com');
  process.exit(1);
}

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function run() {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log('✅ Set admin:true for', email, 'uid:', user.uid);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

run();
