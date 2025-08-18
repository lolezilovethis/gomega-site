// server.js — serve specific frontend files from private_site/ and provide /api
// Usage:
// 1) put ai.html into ./private_site/ai.html
// 2) set optional BASIC_AUTH_USER and BASIC_AUTH_PASS env vars to enable basic auth
// 3) node server.js

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_FILE = path.join(__dirname, 'store.json');
const SITE_DIR = path.join(__dirname, 'private_site'); // <-- your private folder

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic auth middleware (optional)
const BASIC_USER = process.env.BASIC_AUTH_USER || '';
const BASIC_PASS = process.env.BASIC_AUTH_PASS || '';
function basicAuth(req, res, next){
  if(!BASIC_USER || !BASIC_PASS) return next(); // disabled when env not set
  const auth = req.headers.authorization;
  if(!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate','Basic realm="Gomega AI"');
    return res.status(401).send('Authentication required');
  }
  const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8').split(':');
  const [u,p] = creds;
  if(u === BASIC_USER && p === BASIC_PASS) return next();
  res.setHeader('WWW-Authenticate','Basic realm="Gomega AI"');
  return res.status(403).send('Forbidden');
}

// Serve exactly one HTML file (ai.html) from private_site — no directory listing
app.get(['/','/ai.html'], basicAuth, async (req,res)=>{
  try{
    const filePath = path.join(SITE_DIR, 'ai.html');
    const stat = await fs.stat(filePath).catch(()=>null);
    if(!stat || !stat.isFile()) return res.status(404).send('Not found');
    // Serve file with correct content type
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const data = await fs.readFile(filePath, 'utf8');
    res.send(data);
  }catch(err){
    console.error('serve ai error', err);
    res.status(500).send('Server error');
  }
});

// If you need to serve a small set of assets (css/js/img) without exposing the whole directory,
// expose a narrow static route like /assets/<filename>
app.get('/assets/:file', basicAuth, async (req,res)=>{
  const allowed = ['style.css','app.js','favicon.ico']; // whitelist
  if(!allowed.includes(req.params.file)) return res.status(404).send('Not found');
  const f = path.join(SITE_DIR, 'assets', req.params.file);
  try{
    const data = await fs.readFile(f);
    // very naive content-type mapping:
    if(req.params.file.endsWith('.css')) res.setHeader('Content-Type','text/css; charset=utf-8');
    if(req.params.file.endsWith('.js')) res.setHeader('Content-Type','application/javascript; charset=utf-8');
    res.send(data);
  }catch(e){
    res.status(404).send('Not found');
  }
});

/* ---------------------------
   Simple local "getting smarter" AI storage + endpoints
   (same as earlier example)
   ---------------------------*/
async function ensureStore() {
  try { await fs.access(STORE_FILE); } catch(e){
    await fs.writeFile(STORE_FILE, JSON.stringify({ memories: [] }, null, 2), 'utf8');
  }
}
async function readStore(){ await ensureStore(); return JSON.parse(await fs.readFile(STORE_FILE,'utf8')); }
async function writeStore(s){ await fs.writeFile(STORE_FILE, JSON.stringify(s,null,2), 'utf8'); }

function words(text){ return (text||'').toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || []; }
function buildReplyFromMemories(userText, store) {
  const kws = [...new Set(words(userText))];
  if(kws.length===0) return null;
  const hits=[];
  for(const mem of store.memories){
    const mwords = words(mem.text);
    for(const k of kws) if(mwords.includes(k)) { hits.push(mem.text); break; }
  }
  if(hits.length>=2) return `I remember:\n\n- ${hits[0].slice(0,200)}\n- ${hits[1].slice(0,200)}\n\nHope that helps.`;
  if(hits.length===1) return `That reminds me of a note I saved:\n\n${hits[0].slice(0,400)}\n\nWant me to remember this too?`;
  return null;
}
function fallbackReply(userText){
  if(!userText||!userText.trim()) return "Say something and I'll try!";
  const qMark = userText.trim().endsWith('?') ? '' : '.';
  return `You said: "${userText.replace(/\s+/g,' ')}"${qMark}\n\nI'm learning locally as you chat.`;
}

app.get('/api/config', (req,res)=>{
  res.json({ provider:'local', premiumAvailable:false, models:[ {id:'local-sm',label:'local-sm'}, {id:'local-md',label:'local-md'} ] });
});

app.post('/api/chat', basicAuth, async (req,res)=>{
  try{
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find(m=>m.role==='user');
    const userText = lastUser ? lastUser.content || '' : '';

    const store = await readStore();
    if(userText && userText.trim().length>0){
      store.memories.push({ role:'user', text:userText, ts:Date.now() });
    }

    let reply = buildReplyFromMemories(userText, store);
    if(!reply) reply = fallbackReply(userText);

    store.memories.push({ role:'assistant', text:reply, ts:Date.now() });
    await writeStore(store);

    // stream plain text (markdown) back
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding','chunked');
    res.flushHeaders && res.flushHeaders();

    const paragraphs = reply.split(/\n\n+/).map(p=>p.trim()).filter(Boolean);
    for(const p of paragraphs){
      res.write(p + "\n\n");
      await new Promise(r=>setTimeout(r, 250));
    }
    res.end();
  }catch(err){
    console.error('chat error', err);
    res.status(500).json({ error:'internal server error' });
  }
});

// Allow preflight for /api/chat (if browser from different host)
app.options('/api/chat', (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.sendStatus(204);
});

app.listen(PORT, ()=> console.log(`Server listening on http://localhost:${PORT}`));
