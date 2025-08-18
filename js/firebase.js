<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gomega AI — ai.html</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    html, body { height: 100%; }
    .msg p { margin: 0.25rem 0; }
    .msg pre { overflow:auto; padding:0.75rem; border-radius:0.5rem; background:#0f172a; color:#e2e8f0; }
    .msg code:not(pre code) { background:#0f172a; color:#e2e8f0; padding:0.2rem 0.3rem; border-radius:0.3rem; }
    .blinker { animation: blink 1s step-start 0s infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    header .logo { font-weight: 700; letter-spacing: -0.5px; }
    .model-badge { display:inline-block; padding:0.15rem 0.5rem; border-radius:999px; font-size:11px; background:rgba(255,255,255,0.03); color:#cbd5e1; border:1px solid rgba(255,255,255,0.03); }
    .prose-invert img { border-radius: 6px; }
    .status-error { color: #fca5a5; }
    .small-muted { font-size: 12px; color: #94a3b8; }
    .kv { display:flex; gap:0.5rem; align-items:center; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100">
  <div class="min-h-full flex flex-col">
    <header class="sticky top-0 z-20 backdrop-blur bg-slate-900/75 border-b border-slate-800">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500"></div>
        <h1 class="text-xl font-semibold tracking-tight logo">Gomega AI</h1>
        <div class="ml-4 text-xs text-slate-400 hidden md:block">Lightweight, Firebase-backed assistant</div>

        <!-- ADDED: auth UI (sign in/out) -->
        <div id="authArea" class="ml-auto flex items-center gap-2">
          <div id="userInfo" class="text-xs text-slate-300 hidden md:block"></div>
          <button id="signInBtn" class="px-2 py-1 rounded bg-indigo-600 text-xs">Sign in</button>
          <button id="signOutBtn" class="px-2 py-1 rounded bg-slate-800 text-xs hidden">Sign out</button>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <div class="max-w-5xl mx-auto px-4 py-4 grid gap-4 md:grid-cols-[1fr,20rem]">
        <section class="rounded-2xl border border-slate-800 bg-slate-950/50 p-3 md:p-4 flex flex-col min-h-[70vh]">
          <div id="chat" class="flex-1 overflow-y-auto space-y-4 pr-1"></div>

          <form id="composer" class="mt-3" onsubmit="event.preventDefault()">
            <div class="flex items-end gap-2">
              <textarea id="prompt" rows="1" placeholder="Ask anything…" class="flex-1 resize-none bg-slate-800/70 rounded-2xl p-3 outline-none focus:ring-2 focus:ring-indigo-500/60"></textarea>
              <button id="send" type="submit" class="px-4 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-medium">Send</button>
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <label class="flex items-center gap-1">Model
                <select id="model" class="bg-slate-800/70 rounded-lg p-1"></select>
              </label>

              <label class="flex items-center gap-2">Temp
                <input id="temp" type="range" min="0" max="2" step="0.1" value="0.7" />
                <span id="tempv">0.7</span>
              </label>

              <button id="clear" type="button" class="ml-auto underline">Clear chat</button>
            </div>

            <div class="mt-2 flex items-center gap-2 text-xs">
              <div id="modelInfo" class="text-slate-300">Available: <span id="modelList" class="ml-2"></span></div>
            </div>

            <details class="mt-2 text-xs text-slate-300">
              <summary class="cursor-pointer select-none">System prompt</summary>
              <textarea id="system" rows="3" class="w-full mt-2 bg-slate-800/70 rounded-lg p-2" placeholder="You are Gomega AI, a helpful assistant…"></textarea>
            </details>
          </form>

          <div class="mt-2 text-xs text-slate-400">
            <div>Status: <span id="backendStatus">checking...</span></div>
            <div id="backendNote" class="small-muted mt-1"></div>
            <div class="mt-2 text-xs text-slate-500">Tip: append <code>?api=https://api.example.com</code> to override API URL, or use the API override box in Session.</div>
          </div>
        </section>

        <aside class="space-y-3">
          <div id="sessionCard" class="rounded-2xl border border-slate-800 p-4 bg-slate-950/50">
            <h2 class="font-semibold mb-2">Session</h2>
            <div id="sessionMsg" class="text-sm text-slate-300">Backend: <span id="backendShort">checking...</span></div>

            <div class="mt-3 space-y-2">
              <label class="text-xs text-slate-400">API override (optional)</label>
              <div class="flex gap-2">
                <input id="apiInput" type="text" placeholder="https://us-central1-<proj>.cloudfunctions.net/api or /api (hosting)" class="flex-1 rounded px-2 py-1 bg-slate-800 text-xs" />
                <button id="saveApiBtn" class="px-2 py-1 rounded bg-indigo-600 text-xs">Save</button>
              </div>
              <div class="text-xs small-muted">Current: <span id="currentApiDisplay">/api</span></div>
            </div>

            <div class="mt-3 flex flex-col gap-2">
              <div class="kv">
                <button id="getKeyBtn" class="px-2 py-1 rounded bg-slate-800 text-xs">Show current key</button>
                <div id="currentKey" class="text-xs text-slate-300 ml-2">—</div>
              </div>

              <div class="kv">
                <input id="keyInput" placeholder="Enter key to activate" class="rounded px-2 py-1 bg-slate-800 text-xs flex-1" />
                <button id="verifyKeyBtn" class="px-2 py-1 rounded bg-indigo-600 text-xs">Verify</button>
              </div>
              <div id="keyResult" class="text-xs small-muted">Key status: <span id="keyStatus">unknown</span></div>
            </div>

            <div class="mt-3 flex items-center gap-2">
              <button id="toggleFallback" class="px-2 py-1 rounded bg-slate-800 text-xs">Use local fallback</button>
              <button id="clearSavedApi" class="px-2 py-1 rounded bg-slate-800 text-xs">Clear saved API</button>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-800 p-4 bg-slate-950/50">
            <h2 class="font-semibold mb-2">Shortcuts</h2>
            <ul class="list-disc list-inside text-sm text-slate-300">
              <li><kbd>Shift+Enter</kbd> for newline</li>
              <li><kbd>/reset</kbd> to start over</li>
            </ul>
          </div>

          <div class="rounded-2xl border border-slate-800 p-4 bg-slate-950/50">
            <h2 class="font-semibold mb-2">About</h2>
            <p class="text-sm text-slate-300">Local-first AI — conversation history is stored in your browser localStorage and optionally on a remote server if configured. If you sign in with Google, some memories will be associated with your account (UID) for context.</p>
            <button id="viewMem" class="mt-2 px-2 py-1 rounded bg-slate-800 text-xs">View recent memories</button>
          </div>
        </aside>
      </div>
    </main>

    <footer class="border-t border-slate-800 text-center text-xs text-slate-500 py-4">© <span id="yr"></span> Gomega</footer>
  </div>

<!-- main script is now a module to import firebase client helpers -->
<script type="module">
import { auth, provider } from './js/firebase.js'; // adjust path if needed
// auth is from your provided js/firebase.js which exports getAuth, provider etc.

// ---------- CONFIG / API selection ----------
const DEFAULT_BASE = "/api";
const QS = new URLSearchParams(location.search);

// Save/Load API override
const SAVED_API_KEY = 'gomega_api_base';
let apiFromQS = QS.get('api');
if(apiFromQS){
  try{ localStorage.setItem(SAVED_API_KEY, apiFromQS); }catch(e){ /* ignore */ }
}
const savedApi = localStorage.getItem(SAVED_API_KEY);
const BASE_URL_RAW = (apiFromQS || savedApi || DEFAULT_BASE);

// Normalize API (add https if likely missing)
function normalizeApi(val){
  if(!val) return val;
  val = String(val).trim();
  if(/^https?:\/\//i.test(val)) return val.replace(/\/+$/,'');
  if(val.indexOf('.') !== -1 && !val.startsWith('/')) return 'https://' + val.replace(/\/+$/,'');
  return val.replace(/\/+$/,'');
}
let BASE_URL = String(normalizeApi(BASE_URL_RAW) || DEFAULT_BASE).replace(/\/+$/,'');

let userProvidedApi = Boolean(apiFromQS || savedApi);
let fallbackEnabled = !userProvidedApi;

/* ---------- DOM refs ---------- */
const $ = (s,p=document)=>p.querySelector(s);
const chatEl = $('#chat'), promptEl = $('#prompt'), form = $('#composer'), sendBtn = $('#send'),
      modelEl = $('#model'), tempEl = $('#temp'), tempvEl = $('#tempv'), systemEl = $('#system'),
      clearBtn = $('#clear'), backendStatusEl = $('#backendStatus'),
      backendShort = $('#backendShort'), viewMem = $('#viewMem'), modelListEl = $('#modelList'),
      backendNote = $('#backendNote'), toggleFallbackBtn = $('#toggleFallback'), clearSavedApiBtn = $('#clearSavedApi'),
      apiInput = $('#apiInput'), saveApiBtn = $('#saveApiBtn'), currentApiDisplay = $('#currentApiDisplay'),
      getKeyBtn = $('#getKeyBtn'), currentKey = $('#currentKey'), keyInput = $('#keyInput'),
      verifyKeyBtn = $('#verifyKeyBtn'), keyStatus = $('#keyStatus'),
      signInBtn = $('#signInBtn'), signOutBtn = $('#signOutBtn'), userInfo = $('#userInfo'),
      yr = $('#yr');

yr.textContent = new Date().getFullYear();
tempEl.addEventListener('input', ()=> tempvEl.textContent = tempEl.value);
function fit(){ promptEl.style.height='auto'; promptEl.style.height=Math.min(promptEl.scrollHeight,220)+'px'; }
promptEl.addEventListener('input', fit); fit();

let history = JSON.parse(localStorage.getItem('gomega_ai_history')||'[]');
systemEl.value = localStorage.getItem('gomega_ai_system')||'';
function save(){ localStorage.setItem('gomega_ai_history', JSON.stringify(history.slice(-50))); localStorage.setItem('gomega_ai_system', systemEl.value||''); }

/* show API */
function refreshCurrentApiDisplay(){
  const saved = localStorage.getItem(SAVED_API_KEY);
  currentApiDisplay.textContent = saved ? normalizeApi(saved) : DEFAULT_BASE;
  apiInput.value = saved ? normalizeApi(saved) : '';
}
refreshCurrentApiDisplay();

/* Helper: get current Firebase ID token (if signed in) */
let cachedIdToken = null;
async function getIdToken() {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    // refresh token if older than ~5 minutes
    const token = await user.getIdToken(true);
    return token;
  } catch (e) {
    console.warn('getIdToken error', e);
    return null;
  }
}

/* Add message / render */
function addMsg(role, html){
  const wrap=document.createElement('div');
  wrap.className='msg flex items-start gap-3';
  wrap.innerHTML = `<div class="w-8 h-8 rounded-xl ${role==='user'?'bg-indigo-600':'bg-fuchsia-600'} flex items-center justify-center text-xs font-bold">${role==='user'?'U':'G'}</div><div class="flex-1 prose prose-invert max-w-none text-sm">${html}</div>`;
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}
function renderMarkdown(md){ return marked.parse(md || '', {breaks:true, gfm:true}); }
function renderHistory(){ chatEl.innerHTML=''; for(const m of history) addMsg(m.role, renderMarkdown(m.content)); }
renderHistory();

/* fallback models */
const FALLBACK = [
  {id:'gomega-5', label:'gomega-5 (best)'},
  {id:'gomega-4o', label:'gomega-4o (balanced)'},
  {id:'gomega-4mini', label:'gomega-4mini (small)'},
  {id:'gomega-3.0', label:'gomega-3.0 (legacy)'},
  {id:'gomega-3mini', label:'gomega-3mini (fast)'},
  {id:'local-sm',label:'local-sm (fast)'},
  {id:'local-md',label:'local-md (learning)'}
];

let backendAvailable = false;

/* fetch with timeout + optional auth token */
async function fetchWithTimeout(url, opts = {}, timeout = 8000){
  const ac = new AbortController();
  const id = setTimeout(()=> ac.abort(), timeout);
  try{
    // attach ID token if present
    const token = await getIdToken();
    const headers = Object.assign({}, (opts.headers || {}));
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(url, Object.assign({}, opts, {signal: ac.signal, headers}));
    clearTimeout(id);
    return r;
  }catch(e){
    clearTimeout(id);
    throw e;
  }
}

/* load config from backend */
async function loadConfig(){
  try{
    // ensure BASE_URL variable is fresh (in case user changed saved api)
    const saved = localStorage.getItem(SAVED_API_KEY) || null;
    BASE_URL = String(normalizeApi((apiFromQS || saved || DEFAULT_BASE))).replace(/\/+$/,'');

    const url = BASE_URL + '/config';
    console.log('loading config from', url);
    const r = await fetchWithTimeout(url, { cache: 'no-store' }, 6000);
    if(!r.ok){
      const txt = await r.text().catch(()=>null);
      console.warn('config fetch failed', r.status, r.statusText, txt);
      throw new Error('config fetch failed '+r.status);
    }
    const cfg = await r.json();
    populate(cfg.models || FALLBACK, !!cfg.premiumAvailable);
    backendAvailable = true;
    backendStatusEl.textContent = `provider=${cfg.provider||'remote'}`;
    backendShort.textContent = cfg.provider||'remote';
    backendNote.textContent = `Using ${BASE_URL}`;
    sendBtn.disabled = false;
  }catch(e){
    console.warn('config load failed', e);
    populate(FALLBACK,false);
    backendAvailable = false;
    backendShort.textContent = 'none';

    if(userProvidedApi && !fallbackEnabled){
      backendStatusEl.innerHTML = `<span class="status-error">Failed to contact provided backend</span>`;
      backendNote.textContent = `Tried: ${BASE_URL}/config — request failed or CORS blocked. Click "Use local fallback" to run a local demo, or clear the saved API.`;
      sendBtn.disabled = true;
      return;
    }

    backendStatusEl.textContent = 'unavailable — using local fallback';
    backendNote.textContent = `No remote backend found at ${BASE_URL}. Using local demo reply.`;
    sendBtn.disabled = false;
  }
}

/* populate models into select and modelList */
function populate(models,premiumAvailable){
  modelEl.innerHTML='';
  modelListEl.innerHTML = '';
  for(const m of models){
    const o=document.createElement('option');
    o.value=m.id; o.textContent=m.label||m.id;
    if(m.premium && !premiumAvailable) o.disabled=true;
    modelEl.appendChild(o);

    const span = document.createElement('span');
    span.className = 'model-badge mr-1';
    span.textContent = m.id;
    modelListEl.appendChild(span);
  }
}

/* initial config load */
loadConfig().catch(e=>console.warn('loadConfig', e));

/* streaming helpers (same as before) */
function isTextEventStream(ct){ return ct && ct.includes('text/event-stream'); }
function isNDJson(ct){ return ct && (ct.includes('ndjson') || ct.includes('application/json') || ct.includes('application/x-ndjson')); }

async function streamToText(resp, onChunk){
  const contentType = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
  console.log('response content-type:', contentType);

  if(isTextEventStream(contentType)){
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      buf += dec.decode(value, {stream:true});
      let lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for(const line of lines) if(line.startsWith('data:')) onChunk(line.replace(/^data:\s*/, ''));
    }
    if(buf.trim().startsWith('data:')) onChunk(buf.replace(/^data:\s*/, ''));
    return;
  }

  if(isNDJson(contentType)){
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      buffer += dec.decode(value, {stream:true});
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for(const line of lines){
        if(!line.trim()) continue;
        try{
          const o = JSON.parse(line);
          const chunk = o.delta || o.text || o.content || o.choices?.[0]?.delta?.content || o.choices?.[0]?.text;
          onChunk(chunk || line);
        }catch(e){ onChunk(line); }
      }
    }
    if(buffer.trim()) { try{ const o=JSON.parse(buffer); onChunk(o.delta||o.text||o.content||buffer); }catch(e){ onChunk(buffer); } }
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while(true){
    const {value, done} = await reader.read();
    if(done) break;
    const chunk = decoder.decode(value, {stream:true});
    onChunk(chunk);
  }
}

/* Local fallback streaming simulation */
function simulateLocalStreaming(prompt, opts, onChunk, onDone){
  const replyIntro = `Gomega (${opts.model}) — local demo reply:\n\n`;
  const core = `I can't reach a remote backend. This is a local demo reply summarizing your message:\n\n"${prompt}"\n\nTry adding ?api=https://your.api.endpoint to connect a real backend.`;
  const full = replyIntro + core;
  let i = 0;
  const interval = setInterval(()=>{
    i += Math.max(1, Math.floor(Math.random()*6));
    onChunk(full.slice(0, i));
    if(i >= full.length){
      clearInterval(interval);
      onDone();
    }
  }, 25);
}

/* -------------------------
   SUBMIT / UI interactions
   ------------------------- */
form.addEventListener('submit', async e=>{
  e.preventDefault();
  const content = promptEl.value.trim(); if(!content) return;
  if(content==='/reset'){ history=[]; save(); renderHistory(); promptEl.value=''; return; }

  history.push({ role:'user', content });
  addMsg('user', renderMarkdown(content));
  promptEl.value=''; fit();

  const placeholder = document.createElement('div');
  placeholder.className = 'msg flex items-start gap-3';
  placeholder.innerHTML = `<div class="w-8 h-8 rounded-xl bg-fuchsia-600 flex items-center justify-center text-xs font-bold">G</div><div class="flex-1 prose prose-invert max-w-none text-sm"><span class="blinker">▍</span></div>`;
  const bodyEl = placeholder.children[1];
  chatEl.appendChild(placeholder);
  chatEl.scrollTop = chatEl.scrollHeight;
  sendBtn.disabled = true;

  try{
    const payload = { modelId: modelEl.value, temperature: Number(tempEl.value), system: systemEl.value || undefined, messages: history.slice(-20), stream: true };

    if(!backendAvailable && userProvidedApi && !fallbackEnabled){
      bodyEl.innerHTML = renderMarkdown('**Error:** Provided API unreachable. Check console and network (CORS / HTTPS).');
      sendBtn.disabled = false;
      return;
    }

    if(!backendAvailable){
      let acc = '';
      await new Promise((resolve) => {
        simulateLocalStreaming(content, { model: payload.modelId }, chunk => {
          acc = chunk;
          bodyEl.innerHTML = renderMarkdown(acc);
          chatEl.scrollTop = chatEl.scrollHeight;
        }, () => { resolve(); });
      });
      history.push({ role:'assistant', content: acc });
      save();
      return;
    }

    // call backend (attach ID token in fetchWithTimeout)
    const resp = await fetchWithTimeout(BASE_URL + '/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }, 12000);

    if(resp.status === 402 || resp.status === 403){
      const j = await resp.json().catch(()=>({error:'premium'}));
      bodyEl.innerHTML = renderMarkdown('**Error:** ' + (j.error||'premium'));
      return;
    }
    if(!resp.ok){
      const txt = await resp.text().catch(()=>null);
      console.log('chat non-ok', resp.status, resp.statusText, txt);
      bodyEl.innerHTML = renderMarkdown(`**Error:** server returned ${resp.status} ${resp.statusText}\n\nSee console for details.`);
      return;
    }
    if(!resp.body) throw new Error('No response body');

    let acc = '';
    await streamToText(resp, chunk => {
      acc += chunk;
      bodyEl.innerHTML = renderMarkdown(acc);
      chatEl.scrollTop = chatEl.scrollHeight;
    });

    history.push({ role:'assistant', content: acc });
    save();
  }catch(err){
    console.error('chat error', err);
    bodyEl.innerHTML = renderMarkdown('**Error:** ' + (err.message || String(err)));
  }finally{
    sendBtn.disabled = false;
  }
});

clearBtn.addEventListener('click', ()=>{ history=[]; save(); renderHistory(); });
promptEl.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit(); } });

viewMem.addEventListener('click', async ()=>{
  // show memories via backend (which now stores them in Firestore)
  if(!backendAvailable){
    const list = history.slice(-10).map(h => `${h.role.toUpperCase()}: ${h.content.replace(/\n/g,' ').slice(0,120)}`).join('\n\n');
    alert(list || 'No recent memories stored locally.');
    return;
  }
  try{
    const r = await fetchWithTimeout(BASE_URL + '/memories', { cache: 'no-store' });
    if(!r.ok){ console.log('memories fetch failed', r.status); alert('Failed to fetch memories from backend.'); return; }
    const j = await r.json();
    const display = (j.memories || []).slice(-20).map(m => `${m.role.toUpperCase()}: ${String(m.text||'').slice(0,120)}`).join('\n\n');
    alert(display || 'No memories returned from backend.');
  }catch(e){ console.log('memories error', e); alert('Failed to fetch memories (see console)'); }
});

/* ---------- API override handlers ---------- */
saveApiBtn.addEventListener('click', ()=>{
  let val = apiInput.value.trim();
  if(!val) {
    alert('Enter a URL like https://us-central1-<proj>.cloudfunctions.net/api or /api');
    return;
  }
  val = normalizeApi(val);
  try{ localStorage.setItem(SAVED_API_KEY, val); }catch(e){}
  userProvidedApi = true;
  fallbackEnabled = false;
  refreshCurrentApiDisplay();
  location.reload();
});

clearSavedApiBtn.addEventListener('click', ()=>{
  localStorage.removeItem(SAVED_API_KEY);
  userProvidedApi = false;
  backendNote.textContent = 'Cleared saved API. Reload the page to try default/local behavior.';
  alert('Saved API cleared. Reload the page.');
});

/* ---------- Key endpoints ---------- */
getKeyBtn.addEventListener('click', async ()=>{
  const target = normalizeApi(localStorage.getItem(SAVED_API_KEY) || QS.get('api') || DEFAULT_BASE);
  try{
    const r = await fetchWithTimeout(target + '/key', { cache: 'no-store' });
    if(!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    currentKey.textContent = j.key || '(no key returned)';
  }catch(err){
    console.error('get key error', err);
    currentKey.textContent = 'error';
    alert('Failed to fetch key. Check that API is set and reachable (CORS, HTTPS).');
  }
});

verifyKeyBtn.addEventListener('click', async ()=>{
  const k = keyInput.value.trim();
  if(!k){ alert('Enter a key to verify'); return; }
  const target = normalizeApi(localStorage.getItem(SAVED_API_KEY) || QS.get('api') || DEFAULT_BASE);
  try{
    const r = await fetchWithTimeout(target + '/verify-key', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: k }) });
    if(!r.ok) throw new Error('verify failed ' + r.status);
    const j = await r.json();
    keyStatus.textContent = j.valid ? 'valid' : 'invalid';
    keyStatus.style.color = j.valid ? '#86efac' : '#fca5a5';
    if(j.valid) alert('Key valid — app activated.');
  }catch(err){
    console.error('verify key error', err);
    keyStatus.textContent = 'error';
    alert('Failed to verify key. Check API URL and network (CORS).');
  }
});

/* Toggle fallback button */
toggleFallbackBtn.addEventListener('click', ()=>{
  fallbackEnabled = !fallbackEnabled;
  toggleFallbackBtn.textContent = fallbackEnabled ? 'Using local fallback' : 'Use local fallback';
  toggleFallbackBtn.classList.toggle('bg-indigo-600', fallbackEnabled);
  toggleFallbackBtn.classList.toggle('bg-slate-800', !fallbackEnabled);

  if(fallbackEnabled && !backendAvailable){
    backendStatusEl.textContent = 'using local fallback';
    backendNote.textContent = `Local demo active. Clear saved API to stop trying remote backend.`;
    sendBtn.disabled = false;
  }else if(!fallbackEnabled && userProvidedApi && !backendAvailable){
    backendStatusEl.innerHTML = `<span class="status-error">Provided API unreachable</span>`;
    sendBtn.disabled = true;
  }
});

/* initial toggle look */
toggleFallbackBtn.textContent = fallbackEnabled ? 'Using local fallback' : 'Use local fallback';
if(fallbackEnabled) toggleFallbackBtn.classList.add('bg-indigo-600'); else toggleFallbackBtn.classList.add('bg-slate-800');

/* Re-run loadConfig after a short delay (useful if localStorage API override was set before page load) */
setTimeout(()=>{ loadConfig().catch(e=>console.warn('loadConfig', e)); }, 300);

/* =========================
   Firebase Auth UI wiring
   ========================= */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    userInfo.textContent = user.displayName ? `${user.displayName} (${user.email})` : user.email || user.uid;
    userInfo.style.display = 'block';
    signInBtn.classList.add('hidden');
    signOutBtn.classList.remove('hidden');
    // refresh token in background
    try { cachedIdToken = await user.getIdToken(true); } catch(e){ cachedIdToken = null; }
  } else {
    userInfo.textContent = '';
    userInfo.style.display = 'none';
    signInBtn.classList.remove('hidden');
    signOutBtn.classList.add('hidden');
    cachedIdToken = null;
  }
});

signInBtn.addEventListener('click', async ()=>{
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error('signin error', e);
    alert('Sign-in failed: ' + (e && e.message));
  }
});
signOutBtn.addEventListener('click', async ()=>{
  try { await auth.signOut(); } catch(e){ console.error('signout', e); }
});

/* done module */
</script>
</body>
</html>
