// set-admin.js
// Usage:
//   SA_PATH=./serviceAccountKey.json node set-admin.js            # sets admin for gomegaassist@gmail.com
//   SA_PATH=./serviceAccountKey.json node set-admin.js --remove  # removes admin claim for that email
//
// Make sure the service account JSON has privileges to manage users (Editor or IAM User Admin).

const admin = require('firebase-admin');

const SA_PATH = process.env.SA_PATH;
if (!SA_PATH) {
  console.error('Set SA_PATH env var to the service-account json path.\nExample: SA_PATH=./serviceAccountKey.json node set-admin.js');
  process.exit(1);
}

const EMAIL = 'gomegaassist@gmail.com';
const REMOVE = process.argv.includes('--remove');

try {
  const serviceAccount = require(SA_PATH);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
  console.error('Failed to load service account JSON:', e.message || e);
  process.exit(1);
}

(async () => {
  try {
    const user = await admin.auth().getUserByEmail(EMAIL);
    const uid = user.uid;
    console.log(`Found user ${EMAIL} (uid: ${uid})`);

    const existing = user.customClaims || {};
    if (REMOVE) {
      // remove admin flag
      const { admin: _, ...rest } = existing;
      await admin.auth().setCustomUserClaims(uid, rest);
      console.log(`Removed admin claim for ${EMAIL}`);
    } else {
      // add admin:true (preserve other claims)
      const newClaims = Object.assign({}, existing, { admin: true });
      await admin.auth().setCustomUserClaims(uid, newClaims);
      console.log(`Set admin claim for ${EMAIL}`);
    }

    // print resulting claims for confirmation
    const updated = await admin.auth().getUser(uid);
    console.log('Resulting custom claims:', updated.customClaims || {});
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
