// server.js
// Single-file local AI server that learns from conversations.
// Usage:
// 1) put ai.html in same folder as this file (or edit the route below).
// 2) optionally set BASIC_AUTH_USER and BASIC_AUTH_PASS environment variables
// 3) npm init -y && npm install express
// 4) node server.js
//
// API:
// GET  /api/config       -> returns available models
// POST /api/chat         -> stream response (expects JSON {modelId,messages,system,temperature,stream:true})
// GET  /api/memories     -> (debug) returns stored memories
//
// The server stores data in store.json in same folder.

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_FILE = path.join(__dirname, 'store.json');
const FRONTEND_FILE = path.join(__dirname, 'ai.html');

// Optional Basic Auth
const BASIC_USER = process.env.BASIC_AUTH_USER || '';
const BASIC_PASS = process.env.BASIC_AUTH_PASS || '';

app.use(express.json({ limit: '1mb' }));

function checkBasicAuth(req, res, next){
  if(!BASIC_USER || !BASIC_PASS) return next();
  const auth = req.headers.authorization;
  if(!auth || !auth.startsWith('Basic ')){
    res.setHeader('WWW-Authenticate','Basic realm="Gomega AI"');
    return res.status(401).send('Authentication required');
  }
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if(user === BASIC_USER && pass === BASIC_PASS) return next();
  res.setHeader('WWW-Authenticate','Basic realm="Gomega AI"');
  return res.status(403).send('Forbidden');
}

// --- Storage helpers
async function ensureStore(){
  try{
    await fs.access(STORE_FILE);
  }catch(e){
    const initial = { memories: [] };
    await fs.writeFile(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}
async function readStore(){
  await ensureStore();
  const raw = await fs.readFile(STORE_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writeStore(store){
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// --- Text helpers
function tokenize(text){
  if(!text) return [];
  return String(text).toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [];
}
function computeTF(tokens){
  const tf = {};
  if(!tokens || tokens.length===0) return tf;
  for(const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const n = tokens.length;
  for(const k of Object.keys(tf)) tf[k] = tf[k]/n;
  return tf;
}
function computeIDF(memories){
  // idf = log((N+1)/(df+1)) + 1
  const N = memories.length;
  const df = {};
  for(const m of memories){
    const seen = new Set(tokenize(m.text));
    for(const w of seen) df[w] = (df[w] || 0) + 1;
  }
  const idf = {};
  for(const [w,c] of Object.entries(df)){
    idf[w] = Math.log((N + 1) / (c + 1)) + 1;
  }
  return idf;
}
function vectorFromTF(tf, idf){
  const vec = {};
  for(const [w,tfv] of Object.entries(tf)){
    if(idf[w]) vec[w] = tfv * idf[w];
    else vec[w] = tfv * 0.1; // small weight for unknown words
  }
  return vec;
}
function dot(a,b){
  let s = 0;
  for(const k of Object.keys(a)){
    if(b[k]) s += a[k] * b[k];
  }
  return s;
}
function norm(a){
  let s = 0;
  for(const v of Object.values(a)) s += v*v;
  return Math.sqrt(s || 1);
}
function cosineSim(a,b){
  const n = dot(a,b);
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : (n / d);
}

// --- Markov chain generator (very small, optional)
function buildMarkovChain(texts, order = 2){
  const chain = {};
  for(const t of texts){
    const toks = t.split(/\s+/).filter(Boolean);
    for(let i=0;i<=toks.length-order;i++){
      const key = toks.slice(i, i+order).join(' ').toLowerCase();
      const next = toks[i+order] || '';
      chain[key] = chain[key] || [];
      if(next) chain[key].push(next);
    }
  }
  return chain;
}
function generateFromMarkov(chain, maxWords = 40){
  const keys = Object.keys(chain);
  if(keys.length === 0) return '';
  let key = keys[Math.floor(Math.random() * keys.length)];
  const parts = key.split(' ');
  for(let i=0;i<maxWords;i++){
    const options = chain[key];
    if(!options || options.length === 0) break;
    const next = options[Math.floor(Math.random() * options.length)];
    parts.push(next);
    const sliceStart = Math.max(0, parts.length - key.split(' ').length);
    key = parts.slice(sliceStart, sliceStart + key.split(' ').length).join(' ');
  }
  return parts.join(' ');
}

// --- Retrieval
async function searchMemories(userText, topN = 4){
  const store = await readStore();
  const memories = store.memories || [];
  if(memories.length === 0) return [];

  const tokens = tokenize(userText);
  const userTF = computeTF(tokens);
  const idf = computeIDF(memories);
  const userVec = vectorFromTF(userTF,idf);

  const scored = memories.map(m => {
    const mtokens = tokenize(m.text);
    const mtf = computeTF(mtokens);
    const mvec = vectorFromTF(mtf,idf);
    const sim = cosineSim(userVec, mvec);
    return { mem: m, sim };
  });

  scored.sort((a,b) => b.sim - a.sim);
  return scored.slice(0, topN).filter(s => s.sim > 0).map(s => ({ text: s.mem.text, role: s.mem.role, ts: s.mem.ts, score: s.sim }));
}

// --- Reply builder
async function buildReply(userText, messages, opts = {}){
  const store = await readStore();
  // 1) Retrieve similar memories
  const hits = await searchMemories(userText, 5);

  // 2) If good matches, craft a retrieval-augmented response
  if(hits.length >= 2 && hits[0].score > 0.12){
    let out = `I found some related things from earlier:\n\n`;
    for(const h of hits.slice(0,3)){
      out += `- (${h.role}) ${h.text.slice(0,200)}\n`;
    }
    out += `\nBased on those, here are a few suggestions:\n\n`;
    // try Markov on relevant texts for variety
    const chain = buildMarkovChain(hits.map(h=>h.text));
    const gen = generateFromMarkov(chain, 30);
    if(gen) out += `${gen}\n\n`;
    out += `If you'd like I can remember this conversation for future reference.`;
    return out;
  }

  // 3) If single decent hit
  if(hits.length === 1 && hits[0].score > 0.09){
    return `That reminds me of something I saved earlier:\n\n"${hits[0].text}"\n\nWould you like me to save this new message too?`;
  }

  // 4) No hits: produce an informed fallback:
  // - echo
  // - propose helpful steps
  // - optionally use Markov built from all memories
  let reply = '';
  if(userText.endsWith('?')) reply += `Good question. `;
  reply += `You said: "${userText.replace(/\s+/g,' ').trim()}"\n\n`;
  reply += `Here are some quick ideas:\n\n- Try summarizing what you want clearly.\n- Ask me to "remember" important facts and I'll keep them.\n\n`;
  // attach a tiny Markov result built from all memories (if many)
  if(store.memories && store.memories.length > 5){
    const allTexts = store.memories.map(m => m.text);
    const chain = buildMarkovChain(allTexts);
    const gen = generateFromMarkov(chain, 25);
    if(gen) reply += `Also: ${gen}\n\n`;
  }
  reply += `If you'd like me to remember this, say "remember:" followed by the fact.`;
  return reply;
}

// --- Add memory (stores both user and assistant messages)
async function addMemory(role, text){
  if(!text || !text.trim()) return;
  const store = await readStore();
  store.memories = store.memories || [];
  const mem = { id: crypto.randomUUID(), role, text, ts: Date.now() };
  store.memories.push(mem);
  // keep store bounded (optional)
  if(store.memories.length > 5000) store.memories = store.memories.slice(-4000);
  await writeStore(store);
}

// --- Routes

// Serve frontend page (protected by Basic Auth if enabled)
app.get(['/','/ai.html'], checkBasicAuth, async (req,res) => {
  try{
    const html = await fs.readFile(FRONTEND_FILE, 'utf8');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  }catch(e){
    res.status(500).send('ai.html not found on server. Place ai.html next to server.js');
  }
});

// Config
app.get('/api/config', checkBasicAuth, (req,res) => {
  res.json({
    provider: 'local-gomega',
    premiumAvailable: false,
    models: [
      { id: 'local-sm', label: 'local-sm (fast)', premium: false },
      { id: 'local-md', label: 'local-md (learning)', premium: false }
    ]
  });
});

// Chat - accepts messages and streams back a reply
app.post('/api/chat', checkBasicAuth, async (req, res) => {
  try{
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = body.system || '';
    const modelId = body.modelId || 'local-md';
    const temperature = Number(body.temperature || 0.7);

    // find last user message
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser ? String(lastUser.content || '') : '';

    // store user message immediately
    if(userText && userText.trim()) await addMemory('user', userText);

    // build reply
    const replyText = await buildReply(userText, messages, { modelId, temperature, system });

    // store assistant reply
    await addMemory('assistant', replyText);

    // stream reply back in chunks (markdown/plain)
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding','chunked');
    // For CORS from other origin during testing (adjust in production)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.flushHeaders && res.flushHeaders();

    // break reply into paragraphs and stream with slight delay
    const paras = replyText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    for(let i=0;i<paras.length;i++){
      // small variability for "temperature"
      const chunk = paras[i] + (i < paras.length-1 ? '\n\n' : '');
      res.write(chunk);
      // simulate thinking time; temperature influences delay jitter
      const delay = 120 + Math.round(Math.random() * 120 * (1 + (0.5 - Math.random()) * temperature));
      await new Promise(r => setTimeout(r, delay));
    }
    res.end();
  }catch(err){
    console.error('chat error', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Preflight
app.options('/api/chat', (req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.sendStatus(204);
});

// Debug: list memories (timestamps)
app.get('/api/memories', checkBasicAuth, async (req,res) => {
  const store = await readStore();
  res.json({ count: store.memories.length, memories: store.memories.slice(-200) });
});

// Start server
app.listen(PORT, () => {
  console.log(`Gomega AI server listening on http://localhost:${PORT}`);
  if(BASIC_USER && BASIC_PASS) console.log(`Basic auth enabled (user: ${BASIC_USER})`);
});
