// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());
// allow CORS from anywhere for development; tighten origin for production
app.use(cors({ origin: true }));

// Load config (gmail/openai etc) from functions config if set
const gmailUser = functions.config().gmail && functions.config().gmail.user;
const gmailPass = functions.config().gmail && functions.config().gmail.pass;
const serviceSalt = (functions.config().service && functions.config().service.salt) || "";

let transporter = null;
if (gmailUser && gmailPass) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass }
  });
}

// MODELS list — returned by /config
const MODELS = [
  { id: 'gomega-5', label: 'gomega-5 (best)' },
  { id: 'gomega-4o', label: 'gomega-4o (balanced)' },
  { id: 'gomega-4mini', label: 'gomega-4mini (small)' },
  { id: 'gomega-3.0', label: 'gomega-3.0 (legacy)' },
  { id: 'gomega-3mini', label: 'gomega-3mini (fast)' },
  { id: 'local-sm', label: 'local-sm (fast)' },
  { id: 'local-md', label: 'local-md (learning)' }
];

function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12));
  const raw = "gomega-firebase-salt-" + interval + serviceSalt;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

/* Simple keyword extraction */
const STOPWORDS = new Set([
  'the','and','for','with','that','this','from','have','has','was','were','are','you','your','but','not','all','they','their','them','then','when','what','how','why','where','who','which','will','can','could','would','should','a','an','in','on','at','to','of','is','it','i','me','my','we','us','our'
]);

function extractKeywords(text) {
  if (!text) return [];
  const t = text.toLowerCase().replace(/[`~!@#$%^&*()_\-+=[\]{};:'"\\|,<.>/?]/g, ' ');
  const parts = t.split(/\s+/).filter(Boolean);
  const freq = {};
  for (const w of parts) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  const keys = Object.keys(freq).sort((a,b) => freq[b]-freq[a] || b.length - a.length);
  return keys.slice(0, 8);
}

/* Firestore helpers */
async function pushMemoryToFirestore(role, text, userId) {
  const ts = Date.now();
  const keywords = extractKeywords(String(text || ''));
  const summary = String(text || '').slice(0, 120);
  await db.collection('memories').add({ role, text: String(text || ''), summary, keywords, ts, userId: userId || null });
  // optionally trim old docs: not implemented here (Firestore billing caution)
}

/* Retrieve recent memories and score them by shared keywords (simple heuristic) */
async function findRelevantFromFirestore(keywords, limit = 6) {
  if (!keywords || !keywords.length) return [];
  // fetch recent N memories (e.g. 1000) then score in memory
  // Firestore doesn't support fast full-text match without indexing or Algolia; this is a simple fallback
  const q = db.collection('memories').orderBy('ts', 'desc').limit(1000);
  const snap = await q.get();
  const scored = [];
  snap.forEach(doc => {
    const m = doc.data();
    let score = 0;
    const textLower = (m.text || '').toLowerCase();
    for (const k of keywords) {
      if (textLower.includes(k)) score += 2;
      if ((m.keywords || []).includes(k)) score += 1;
    }
    if (score > 0) scored.push({ m, score });
  });
  scored.sort((a,b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.m);
}

/* Middleware: try to verify Firebase ID token if provided via Authorization: Bearer ... */
async function tryVerifyToken(req) {
  const authHeader = req.headers && req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded; // contains uid, email, etc.
  } catch (e) {
    console.warn('token verify failed', e && e.message);
    return null;
  }
}

/* Endpoints */

// GET /config
app.get('/config', (req, res) => {
  res.json({
    provider: 'gomega-firebase',
    premiumAvailable: false,
    models: MODELS,
    info: 'Firebase Functions with Firestore-backed memories'
  });
});

// GET /key
app.get('/key', (req, res) => {
  res.json({ key: getCurrentKey() });
});

// POST /verify-key
app.post('/verify-key', (req, res) => {
  const { key } = req.body || {};
  res.json({ valid: key === getCurrentKey() });
});

// POST /chat
app.post('/chat', async (req, res) => {
  try {
    const user = await tryVerifyToken(req); // may be null
    const uid = user ? user.uid : null;

    const { modelId = 'gomega-5', temperature = 0.7, system, messages = [] } = req.body || {};
    // find last user message
    let lastUser = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = messages[i].content; break; }
    }
    const userText = String(lastUser || '').trim();

    if (userText) await pushMemoryToFirestore('user', userText, uid);

    const kw = extractKeywords(userText);
    if (kw.length && userText) await pushMemoryToFirestore('meta', `keywords:${kw.join(', ')} — ${userText.slice(0,120)}`, uid);

    // lookup relevant memories from firestore
    const relevant = await findRelevantFromFirestore(kw, 6);

    // Build reply
    const today = new Date().toLocaleString();
    const parts = [];
    parts.push(`Gomega (${modelId}) — firebase backend.`);
    parts.push(`Date: ${today}`);
    if (system) parts.push(`System: ${system}`);

    if (userText.toLowerCase().includes('date') || userText.toLowerCase().includes('time') || userText.toLowerCase().includes('today')) {
      parts.push('');
      parts.push(`You asked about today's date/time. Right now it is: ${today}.`);
    } else {
      if (relevant.length) {
        parts.push('');
        parts.push('Relevant memories I found:');
        for (const m of relevant) parts.push(`- (${m.role}) ${m.summary}${m.keywords && m.keywords.length ? ` [tags: ${m.keywords.slice(0,5).join(', ')}]` : ''}`);
      }

      let answer = '';
      if (userText.endsWith('?') || /how|what|why|where|when|help|suggest|advise|fix|who|which/i.test(userText)) {
        answer = `Approach for "${userText}":\n1) Clarify the goal.\n2) Quick idea: search keywords: ${kw.slice(0,5).join(', ') || '...'}.\n3) Ask for "step" for step-by-step guidance.`;
      } else {
        const short = userText.length ? userText.slice(0, 200) : '(no input)';
        answer = `I received: "${short}". I can save memories and reference them later. Say "remember: ..." to store a specific note.`;
      }
      parts.push('');
      parts.push(answer);
    }

    const replyText = parts.join('\n');

    // store assistant reply
    await pushMemoryToFirestore('assistant', replyText, uid);

    // Return non-streaming JSON (frontend expects this)
    return res.json({ choices: [{ text: replyText }], reply: replyText });
  } catch (err) {
    console.error('chat error', err);
    return res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

// GET /memories (returns last N memories)
app.get('/memories', async (req, res) => {
  try {
    const snap = await db.collection('memories').orderBy('ts', 'desc').limit(200).get();
    const out = [];
    snap.forEach(d => {
      const v = d.data();
      out.push({ role: v.role, text: v.text, summary: v.summary, keywords: v.keywords, ts: v.ts, userId: v.userId || null });
    });
    res.json({ count: out.length, memories: out });
  } catch (err) {
    console.error('memories error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// sendEmail function (optional)
exports.sendEmail = functions.https.onRequest((req, res) => {
  cors({ origin: true })(req, res, async () => {
    if (!transporter) return res.status(500).send('Email not configured.');
    try {
      const { type, email, school } = req.body || {};
      if (!type || !email || !school) return res.status(400).send('Missing fields.');
      let subject = '', text = '';
      if (type === 'submitted') { subject = 'Opt-Out Request Submitted'; text = `Your request to opt-out "${school}" has been received.`; }
      else if (type === 'approved') { subject = 'Opt-Out Request Approved'; text = `Your request for "${school}" has been approved.`; }
      else if (type === 'declined') { subject = 'Opt-Out Request Declined'; text = `Your request to opt-out "${school}" has been declined.`; }
      else return res.status(400).send('Invalid type.');

      await transporter.sendMail({ from: `"Gomega Admin" <${gmailUser}>`, to: email, subject, text });
      res.status(200).send('Email sent.');
    } catch (err) {
      console.error('sendEmail error', err);
      res.status(500).send('Failed to send email.');
    }
  });
});

// Export Express app as "api"
exports.api = functions.https.onRequest(app);
