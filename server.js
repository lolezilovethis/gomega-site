/**
 * server.js
 *
 * Single-file local AI demo server.
 * - Serves /ai.html (your ai.html if present in same folder; otherwise embedded fallback)
 * - Exposes /api/config, /api/chat, /api/memories, /api/key, /api/verify-key
 * - Persists memories into store.json
 *
 * Usage:
 *  npm init -y
 *  npm install express cors
 *  node server.js
 *
 * Open http://localhost:3000/ai.html
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const STORE_FILE = path.join(__dirname, 'store.json');

const app = express();
app.use(express.json());
app.use(cors()); // allow from anywhere on local machine

// ---------- Storage helpers ----------
let store = { memories: [] };

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      store = JSON.parse(raw);
      if (!store.memories) store.memories = [];
    } else {
      store = { memories: [] };
    }
  } catch (e) {
    console.error('Failed to load store.json:', e);
    store = { memories: [] };
  }
}
function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save store.json:', e);
  }
}
loadStore();

// Keep store size bounded
function pushMemory(role, text) {
  const ts = Date.now();
  const summary = String(text || '').slice(0, 100);
  const keywords = extractKeywords(String(text || ''));
  store.memories.push({ role, text: String(text || ''), summary, keywords, ts });
  // cap
  while (store.memories.length > 2000) store.memories.shift();
  saveStore();
}

// ---------- Simple keyword extraction ----------
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

// ---------- Memory retrieval ----------
function findRelevantMemories(keywords, limit = 6) {
  if (!keywords || !keywords.length) return [];
  // Score each memory by count of shared keywords
  const scored = [];
  for (const m of store.memories) {
    let score = 0;
    for (const k of keywords) {
      if (m.text.toLowerCase().includes(k)) score += 2;
      if ((m.keywords || []).includes(k)) score += 1;
    }
    if (score > 0) scored.push({ m, score });
  }
  scored.sort((a,b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.m);
}

// ---------- Models (local pretend) ----------
const MODELS = [
  { id: 'gomega-5', label: 'gomega-5 (best)' },
  { id: 'gomega-4o', label: 'gomega-4o (balanced)' },
  { id: 'gomega-4mini', label: 'gomega-4mini (small)' },
  { id: 'gomega-3.0', label: 'gomega-3.0 (legacy)' },
  { id: 'gomega-3mini', label: 'gomega-3mini (fast)' },
  { id: 'local-sm', label: 'local-sm (fast)' },
  { id: 'local-md', label: 'local-md (learning)' }
];

// ---------- Utility: today's date string ----------
function todayString() {
  const d = new Date();
  return d.toLocaleString(); // localized date+time
}

// ---------- API: config ----------
app.get('/api/config', (req, res) => {
  res.json({
    provider: 'gomega-local',
    premiumAvailable: false,
    models: MODELS,
    info: 'Local demo backend — responses are generated locally and memories are stored in store.json'
  });
});

// ---------- API: key / verify-key (rotating every 12 hours) ----------
function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12));
  const raw = 'gomega-local-salt-' + interval;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}
app.get('/api/key', (req, res) => {
  res.json({ key: getCurrentKey() });
});
app.post('/api/verify-key', (req, res) => {
  const { key } = req.body || {};
  res.json({ valid: key === getCurrentKey() });
});

// ---------- API: chat ----------
/**
 * POST /api/chat
 * body: { modelId, temperature, system, messages, stream }
 *
 * We'll:
 * - take last user message,
 * - extract keywords and add to memory,
 * - search for relevant memories,
 * - build a short reply that includes: model label, today's date, relevant memories, and a helpful answer.
 *
 * This is a local heuristic-based "assistant" that will "learn" by storing user messages and keywords.
 */
app.post('/api/chat', (req, res) => {
  try {
    const body = req.body || {};
    const modelId = body.modelId || 'gomega-5';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    // get last user message (look from end)
    let lastUser = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUser = messages[i].content; break; }
    }
    const userText = String(lastUser || '').trim();

    // store the user message as memory (quick learning)
    if (userText) pushMemory('user', userText);

    // extract keywords and store them as "memory tags" (improves retrieval)
    const kw = extractKeywords(userText);
    if (kw.length && userText) {
      // also store a short memory summarizing keywords
      pushMemory('meta', `keywords:${kw.join(', ')} — from: ${userText.slice(0, 120)}`);
    }

    // retrieve relevant memories for context
    const relevant = findRelevantMemories(kw, 6);

    // Compose the assistant reply with simple heuristics:
    // - If user asked about the date/time, return date
    // - Otherwise include relevant memories and then an actionable/helpful reply
    let replyParts = [];
    replyParts.push(`Gomega (${modelId}) — local assistant (demo).`);
    replyParts.push(`Date: ${todayString()}`);
    if (body.system) replyParts.push(`System: ${body.system}`);

    if (userText.toLowerCase().includes('date') || userText.toLowerCase().includes('time') || userText.toLowerCase().includes("today")) {
      replyParts.push('');
      replyParts.push(`You asked about today's date/time. Right now it is: ${todayString()}.`);
    } else {
      if (relevant.length) {
        replyParts.push('');
        replyParts.push('Relevant memories I found:');
        for (const m of relevant) {
          const ts = new Date(m.ts).toLocaleString();
          replyParts.push(`- (${m.role}) ${m.summary}${m.keywords && m.keywords.length ? ` [tags: ${m.keywords.slice(0,5).join(', ')}]` : ''} — ${ts}`);
        }
      }

      // Helpful heuristics to craft a response:
      let answer = '';

      // If message looks like a question:
      if (userText.endsWith('?') || /how|what|why|where|when|help|suggest|advise|fix|why|who|which/i.test(userText)) {
        // Provide a friendly multi-step suggestion
        answer = `Here's how I can help with that:\n\n1) Clarify: ${userText}\n2) Quick suggestion: Try searching for keywords: ${kw.slice(0,5).join(', ') || '...'}.\n3) If you want step-by-step help, say "step" or "explain".\n\nIf you want me to remember something important from this conversation, say "remember: <your note>".`;
      } else {
        // short friendly reply that repeats and offers help
        const short = userText.length > 0 ? userText.slice(0, 240) : '(no input)';
        answer = `I received: "${short}"\n\nI can help with research, reminders, quick brainstorming, or saving memories. Try asking me a question or say "remember: ..." to store a note.`;
      }
      replyParts.push('');
      replyParts.push(answer);
    }

    const replyText = replyParts.join('\n');

    // Save the assistant reply as memory
    pushMemory('assistant', replyText);

    // Respond in structure expected by frontend
    res.json({
      reply: replyText,
      choices: [{ text: replyText }]
    });
  } catch (err) {
    console.error('chat handler error', err);
    res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

// ---------- API: memories ----------
app.get('/api/memories', (req, res) => {
  res.json({ count: store.memories.length, memories: store.memories.slice(-200) });
});

// ---------- Serve ai.html (if file present) or an embedded fallback ----------

const EMBEDDED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Gomega AI — Local</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>html,body{height:100%}.msg p{margin:0.25rem 0}.blinker{animation:blink 1s step-start 0s infinite}@keyframes blink{50%{opacity:0}}body{background:#0f172a;color:#e2e8f0;font-family:Inter,system-ui,Arial,sans-serif}#chat{max-width:900px;margin:24px auto;padding:12px}</style>
</head>
<body>
  <div id="chat"><h2>Gomega Local Demo</h2>
  <div style="margin-bottom:12px">This page is a minimal fallback UI. Use your real ai.html (in same folder) for full UI.</div>
  <div id="msgs"></div>
  <div style="margin-top:12px">
    <textarea id="prompt" rows="3" style="width:100%;background:#071025;color:#e6eef8;padding:8px;border-radius:6px"></textarea>
    <div style="margin-top:8px"><button id="send">Send</button> <button id="mem">Show memories</button></div>
  </div>
  </div>
<script>
const api = '/api';
function addMsg(who, text){
  const el = document.createElement('div');
  el.style.border='1px solid rgba(255,255,255,0.04)';
  el.style.padding='8px';
  el.style.margin='8px 0';
  el.innerHTML = '<strong>'+who+':</strong><div style="white-space:pre-wrap;margin-top:6px">'+marked.parse(text)+'</div>';
  document.getElementById('msgs').appendChild(el);
  window.scrollTo(0,document.body.scrollHeight);
}
document.getElementById('send').addEventListener('click', async ()=>{
  const t = document.getElementById('prompt').value.trim();
  if(!t) return;
  addMsg('U', t);
  document.getElementById('prompt').value='';
  addMsg('G', '▍');
  try{
    const r = await fetch(api + '/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({messages:[{role:'user',content:t}], stream:false})});
    const j = await r.json();
    // replace last assistant placeholder
    const msgs = document.getElementById('msgs');
    msgs.lastChild.remove();
    addMsg('G', j.reply || j.choices?.[0]?.text || '(no reply)');
  }catch(e){
    console.error(e);
    document.getElementById('msgs').lastChild.remove();
    addMsg('G', '**Error:** failed to contact local backend');
  }
});
document.getElementById('mem').addEventListener('click', async ()=>{
  const r = await fetch(api + '/memories');
  const j = await r.json();
  addMsg('MEMORIES', JSON.stringify(j.memories.slice(-20), null, 2));
});
</script>
</body>
</html>`;

// Serve provided ai.html if exists, otherwise embedded fallback
app.get(['/','/ai.html'], (req, res) => {
  const localPath = path.join(__dirname, 'ai.html');
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  } else {
    res.type('html').send(EMBEDDED_HTML);
  }
});

// also serve favicon route to silence 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Gomega-local server running on http://localhost:${PORT}`);
  console.log(`Serving ai UI at http://localhost:${PORT}/ai.html`);
});
