const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });

async function main(uid){
  const user = await admin.auth().getUser(uid);
  const claims = user.customClaims || {};
  claims.admin = true;
  await admin.auth().setCustomUserClaims(uid, claims);
  console.log('Added admin to', uid);
}
main(process.argv[2]).catch(console.error);
