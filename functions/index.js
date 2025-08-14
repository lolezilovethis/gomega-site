// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

admin.initializeApp();

// ----- Config for Gmail (use firebase functions:config:set or env vars) -----
const gmailCfg = functions.config && functions.config().gmail ? functions.config().gmail : {};
const GMAIL_USER = process.env.GMAIL_USER || gmailCfg.user || null;
const GMAIL_PASS = process.env.GMAIL_PASS || gmailCfg.pass || null;

// If you plan to use the email endpoints, ensure GMAIL_USER and GMAIL_PASS are set.
// Use Firebase functions config preferred:
// firebase functions:config:set gmail.user="you@gmail.com" gmail.pass="app-password"

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

// Express app (for your existing routes)
const app = express();
app.use(express.json());

// Allow requests only from your site (adjust if needed)
const corsHandler = cors({
  origin: "https://gomega.watch",
});
app.use(corsHandler);

// ---------------- EMAIL SYSTEM (optional) ----------------
app.post("/sendEmail", async (req, res) => {
  // Quick guard: if mail creds not set, return 500
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.error('Gmail creds not configured.');
    return res.status(500).json({ error: 'Email not configured on server.' });
  }

  const { type, email, school } = req.body || {};
  if (!email || !school || !type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  let subject = "";
  let text = "";

  switch (type) {
    case "submitted":
      subject = "Opt-Out Request Submitted";
      text = `Your request to opt-out "${school}" has been received and is pending review.`;
      break;
    case "approved":
      subject = "Opt-Out Request Approved";
      text = `Your request for "${school}" has been approved.\n\nIt may take up to 7 days to delete and IP-ban all users from this school. Please be patient.`;
      break;
    case "declined":
      subject = "Opt-Out Request Declined";
      text = `Your request to opt-out "${school}" has been declined. Contact support for help.`;
      break;
    default:
      return res.status(400).json({ error: "Invalid email type." });
  }

  try {
    await transporter.sendMail({
      from: `"Gomega Admin" <${GMAIL_USER}>`,
      to: email,
      subject,
      text,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ error: "Failed to send email." });
  }
});

// ---------------- KEY SYSTEM ----------------
// Generate a key that changes every 12 hours
function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12)); // every 12h
  const raw = "gomega-secret-salt" + interval;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

app.get("/key", (req, res) => {
  const key = getCurrentKey();
  res.json({ key });
});

app.post("/verify-key", (req, res) => {
  const { key } = req.body || {};
  const isValid = key === getCurrentKey();
  res.json({ valid: isValid });
});

// Export Express API as a regular onRequest function (keeps existing behaviour)
exports.api = functions.region('us-central1').https.onRequest(app);

// ---------------- Callable admin functions (recommended: https.onCall) ----------------
// Helpers
function requireAuth(context) {
  if (!context || !context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
}
function requireAdmin(context) {
  requireAuth(context);
  if (!context.auth.token || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin privileges required.');
  }
}

// getUserByEmail: returns minimal auth info + users/{uid} doc (if exists)
exports.getUserByEmail = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdmin(context);

  const email = (data && data.email || '').toLowerCase().trim();
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required.');
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const uid = userRecord.uid;

    // Fetch Firestore user doc if present (admins are allowed by your rules)
    let docData = null;
    try {
      const userSnap = await admin.firestore().doc(`users/${uid}`).get();
      docData = userSnap.exists ? userSnap.data() : null;
    } catch (e) {
      // don't fail the whole request if doc read has issues, but log it
      console.error('Failed to read users/{uid} doc for', uid, e);
      docData = null;
    }

    // Sanitize docData if needed (you can remove sensitive fields here)
    return {
      uid,
      email: userRecord.email || null,
      displayName: userRecord.displayName || null,
      doc: docData
    };
  } catch (err) {
    console.error('getUserByEmail error:', err);
    // Map common auth errors to HttpsError types
    if (err.code && err.code.includes('auth/user-not-found')) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }
    throw new functions.https.HttpsError('internal', err.message || 'Failed to get user.');
  }
});

// banUser: requireAdmin, append ban entry into users/{uid}.bans, set banned flag, add custom claim
exports.banUser = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdmin(context);

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

    // Append ban entry and set banned flag
    await userRef.set({
      banned: true,
      bans: admin.firestore.FieldValue.arrayUnion(banEntry)
    }, { merge: true });

    // Merge custom claims: preserve existing claims and set banned:true
    const userRecord = await admin.auth().getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    const newClaims = Object.assign({}, existingClaims, { banned: true });
    await admin.auth().setCustomUserClaims(uid, newClaims);

    return { success: true, banEntry };
  } catch (err) {
    console.error('banUser error:', err);
    throw new functions.https.HttpsError('internal', err.message || 'Failed to ban user');
  }
});

// unbanUser: requireAdmin, append unban audit entry, set banned=false, remove banned claim
exports.unbanUser = functions.region('us-central1').https.onCall(async (data, context) => {
  requireAdmin(context);

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

    // Remove banned claim while preserving others
    const userRecord = await admin.auth().getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    const { banned, ...restClaims } = existingClaims; // drop banned
    await admin.auth().setCustomUserClaims(uid, restClaims);

    return { success: true, unbanEntry };
  } catch (err) {
    console.error('unbanUser error:', err);
    throw new functions.https.HttpsError('internal', err.message || 'Failed to unban user');
  }
});
