// createMapping.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // download from Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

function encodeEmailForId(email) {
  // same encoding as client-side btoa replace used in your UI
  const b = Buffer.from(email).toString('base64');
  return b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function writeMap(email, uid) {
  const enc = encodeEmailForId(email);
  await admin.firestore().doc(`usersByEmail/${enc}`).set({ uid, email });
  console.log('wrote mapping', email, uid);
}

// Example: add several mappings
async function main() {
  // CHANGE these to real values (email -> uid)
  const mappings = [
    ['divedyacoub1@gmail.com', 'qrN2IbkBoedQ7qGM8EpKLBleqgi1'],
    ['someuser@example.com', 'USER_UID_HERE']
  ];

  for (const [email, uid] of mappings) {
    await writeMap(email, uid);
  }

  console.log('Done');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
