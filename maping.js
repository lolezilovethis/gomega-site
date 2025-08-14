// mapping.js
// Usage:
//   node mapping.js user@example.com USER_UID
//   node mapping.js mappings.json
//   node mapping.js mappings.csv

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in same folder. Download from Firebase Console -> Project Settings -> Service accounts.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath))
});

const db = admin.firestore();

function encodeEmailForId(email) {
  // Match client-side behavior: btoa then replace +,/ and strip =
  const b64 = Buffer.from(email).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function writeMap(email, uid) {
  const enc = encodeEmailForId(email);
  const docRef = db.doc(`usersByEmail/${enc}`);
  await docRef.set({ uid, email });
  console.log('WROTE:', email, '→', uid, `docId:${enc}`);
}

async function runSingle(email, uid) {
  if (!email || !uid) {
    console.error('Please provide email and uid.');
    process.exit(1);
  }
  await writeMap(email, uid);
  process.exit(0);
}

async function runFromJSON(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { console.error('Invalid JSON:', e); process.exit(1); }
  if (!Array.isArray(arr)) { console.error('JSON must be an array of [email, uid] pairs'); process.exit(1); }
  for (const item of arr) {
    if (!Array.isArray(item) || item.length < 2) { console.warn('Skipping invalid item', item); continue; }
    await writeMap(item[0], item[1]);
  }
  console.log('DONE');
  process.exit(0);
}

async function runFromCSV(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 2) { console.warn('Skipping invalid line:', line); continue; }
    await writeMap(parts[0], parts[1]);
  }
  console.log('DONE');
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('No args. Usage: node mapping.js email uid  OR node mapping.js mappings.json OR node mapping.js mappings.csv');
    process.exit(1);
  }

  const first = args[0];
  if (args.length === 2 && first.indexOf('@') !== -1) {
    // single mapping
    await runSingle(first, args[1]);
  } else {
    // treat first arg as filename (json or csv)
    const file = path.resolve(first);
    if (!fs.existsSync(file)) {
      console.error('File not found:', file);
      process.exit(1);
    }
    if (file.endsWith('.json')) {
      await runFromJSON(file);
    } else if (file.endsWith('.csv')) {
      await runFromCSV(file);
    } else {
      console.error('Unsupported file type. Use .json or .csv');
      process.exit(1);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
