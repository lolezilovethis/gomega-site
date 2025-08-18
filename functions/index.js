// functions/index.js
const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// Express app
const app = express();
app.use(express.json());

// If hosting the frontend on same Firebase Hosting site with rewrites,
// requests will be same-origin so CORS isn't strictly required. Still allow flexible CORS for testing:
app.use(cors({ origin: true }));

// Load secrets from functions config (set via firebase CLI)
const gmailUser = functions.config().gmail && functions.config().gmail.user;
const gmailPass = functions.config().gmail && functions.config().gmail.pass;
const openaiKey = functions.config().openai && functions.config().openai.key; // optional future use

// nodemailer transporter (optional — only if gmailUser & gmailPass provided)
let transporter = null;
if (gmailUser && gmailPass) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass }
  });
}

// Simple in-memory demo store (cold starts will reset — for persistence use Firestore)
const memories = [];

// Simple models list returned to frontend
const MODELS = [
  { id: 'gomega-5', label: 'gomega-5 (best)' },
  { id: 'gomega-4o', label: 'gomega-4o (balanced)' },
  { id: 'gomega-4mini', label: 'gomega-4mini (small)' },
  { id: 'gomega-3.0', label: 'gomega-3.0 (legacy)' },
  { id: 'gomega-3mini', label: 'gomega-3mini (fast)' },
  { id: 'local-sm', label: 'local-sm (fast)' },
  { id: 'local-md', label: 'local-md (learning)' }
];

// Utility: rotating key every 12 hours
function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12));
  const raw = "gomega-secret-salt-" + interval + (functions.config().service && functions.config().service.salt ? functions.config().service.salt : "");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

// Simple keyword extraction & memory helpers (same logic as local server)
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

function pushMemory(role, text) {
  const ts = Date.now();
  const summary = String(text || '').slice(0, 120);
  const keywords = extractKeywords(String(text || ''));
  memories.push({ role, text: String(text || ''), summary, keywords, ts });
  while (memories.length > 2000) memories.shift();
}

// GET /config
app.get('/config', (req, res) => {
  res.json({
    provider: 'gomega-firebase',
    premiumAvailable: false,
    models: MODELS,
    info: 'Firebase Functions demo API (non-streaming).'
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

// POST /chat (non-streaming)
app.post('/chat', async (req, res) => {
  try {
    const { modelId = 'gomega-5', temperature = 0.7, system, messages = [] } = req.body || {};
    // find last user message
    let lastUser = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = messages[i].content; break; }
    }
    const userText = String(lastUser || '').trim();
    if (userText) pushMemory('user', userText);
    const kw = extractKeywords(userText);
    if (kw.length && userText) pushMemory('meta', `keywords:${kw.join(', ')} — ${userText.slice(0,120)}`);

    // find relevant memories by keyword match
    const relevant = [];
    if (kw.length) {
      for (const m of memories) {
        let score = 0;
        for (const k of kw) {
          if (m.text.toLowerCase().includes(k)) score += 2;
          if ((m.keywords || []).includes(k)) score += 1;
        }
        if (score > 0) relevant.push({ m, score });
      }
      relevant.sort((a,b) => b.score - a.score);
    }

    // craft reply (simple heuristics)
    const today = new Date().toLocaleString();
    const parts = [];
    parts.push(`Gomega (${modelId}) — firebase demo.`);
    parts.push(`Date: ${today}`);
    if (system) parts.push(`System: ${system}`);
    if (userText.toLowerCase().includes('date') || userText.toLowerCase().includes('time') || userText.toLowerCase().includes("today")) {
      parts.push('');
      parts.push(`You asked about today's date/time. Right now it is: ${today}.`);
    } else {
      if (relevant.length) {
        parts.push('');
        parts.push('Relevant memories I found:');
        for (const s of relevant.slice(0,6)) {
          const m = s.m;
          parts.push(`- (${m.role}) ${m.summary}${m.keywords && m.keywords.length ? ` [tags:${m.keywords.slice(0,5).join(',')}]` : ''}`);
        }
      }

      // answer heuristics
      let answer = '';
      if (userText.endsWith('?') || /how|what|why|where|when|help|suggest|advise|fix|who|which/i.test(userText)) {
        answer = `Steps to approach "${userText}":\n1) Clarify the exact problem.\n2) Try searching keywords: ${kw.slice(0,5).join(', ') || '...'}.\n3) Ask for "step" to get step-by-step instructions.`;
      } else {
        const short = userText.length ? userText.slice(0, 200) : '(no input)';
        answer = `I received: "${short}". I can save memories, look them up later, and assist with steps. Say "remember: ..." to store a note.`;
      }
      parts.push('');
      parts.push(answer);
    }

    const replyText = parts.join('\n');

    pushMemory('assistant', replyText);

    res.json({ choices:[{ text: replyText }], reply: replyText });
  } catch (err) {
    console.error('chat error', err);
    res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

// GET /memories
app.get('/memories', (req, res) => {
  res.json({ count: memories.length, memories: memories.slice(-200) });
});

// sendEmail endpoint (optional)
exports.sendEmail = functions.https.onRequest((req, res) => {
  cors({ origin: true })(req, res, async () => {
    if (!transporter) return res.status(500).send('Email not configured. Set gmail.user and gmail.pass with firebase functions:config:set');
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

// Export Express app as function "api"
exports.api = functions.https.onRequest(app);
