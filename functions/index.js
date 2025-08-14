// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const ADMIN_EMAIL = 'gomegaassist@gmail.com';

// Helpers for callable functions
function requireAuth(context) {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
}
function requireAdminEmail(context) {
  requireAuth(context);
  const email = (context.auth.token && context.auth.token.email) || '';
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new functions.https.HttpsError('permission-denied', 'Only the designated admin may perform this action.');
  }
}

// getUserByEmail — callable. Returns auth info + Firestore users/{uid} doc (if present)
exports.getUserByEmail = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdminEmail(context);

  const email = (data && data.email || '').toLowerCase().trim();
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required.');
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const uid = userRecord.uid;

    // fetch users/{uid} doc (admin server-side read)
    let docData = null;
    try {
      const snap = await admin.firestore().doc(`users/${uid}`).get();
      docData = snap.exists ? snap.data() : null;
    } catch (e) {
      console.error('Warning: failed to read users/{uid} doc for', uid, e);
      docData = null;
    }

    return {
      uid,
      email: userRecord.email || null,
      displayName: userRecord.displayName || null,
      doc: docData
    };
  } catch (err) {
    console.error('getUserByEmail error', err);
    if (err.code && err.code.includes('auth/user-not-found')) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }
    throw new functions.https.HttpsError('internal', err.message || 'Failed to get user.');
  }
});

// banUser — callable. Appends ban record and sets banned flag in users/{uid}
exports.banUser = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdminEmail(context);

  const { uid, lengthDays, reason, moderatorNote, offensiveItem, title } = (data || {});
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    let endTimestamp = null;
    if (typeof lengthDays === 'number' && isFinite(lengthDays) && lengthDays > 0) {
      endTimestamp = admin.firestore.Timestamp.fromMillis(Date.now() + (lengthDays * 24 * 60 * 60 * 1000));
    }

    const banEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      title: title || `Ban by ${context.auth.uid}`,
      reason: reason || 'Violation of Terms',
      moderatorNote: moderatorNote || '',
      offensiveItem: offensiveItem || '',
      start: now,
      end: endTimestamp,
      reviewedAt: now,
      action: 'ban',
      moderatorUid: context.auth.uid
    };

    const userRef = db.doc(`users/${uid}`);
    await userRef.set({
      banned: true,
      bans: admin.firestore.FieldValue.arrayUnion(banEntry)
    }, { merge: true });

    // Optionally, set a banned custom claim too (not required for this flow)
    // const existing = (await admin.auth().getUser(uid)).customClaims || {};
    // await admin.auth().setCustomUserClaims(uid, Object.assign({}, existing, { banned: true }));

    return { success: true, banEntry };
  } catch (err) {
    console.error('banUser error', err);
    throw new functions.https.HttpsError('internal', err.message || 'Failed to ban user');
  }
});

// unbanUser — callable. Appends unban audit entry and clears banned flag in users/{uid}
exports.unbanUser = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdminEmail(context);

  const { uid, moderatorNote } = (data || {});
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const unbanEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      action: 'unban',
      moderatorNote: moderatorNote || '',
      moderatorUid: context.auth.uid,
      at: now
    };

    const userRef = db.doc(`users/${uid}`);
    await userRef.set({
      banned: false,
      bans: admin.firestore.FieldValue.arrayUnion(unbanEntry)
    }, { merge: true });

    // Optionally remove banned custom claim
    // const userRecord = await admin.auth().getUser(uid);
    // const existing = userRecord.customClaims || {};
    // const { banned, ...rest } = existing;
    // await admin.auth().setCustomUserClaims(uid, rest);

    return { success: true, unbanEntry };
  } catch (err) {
    console.error('unbanUser error', err);
    throw new functions.https.HttpsError('internal', err.message || 'Failed to unban user');
  }
});
