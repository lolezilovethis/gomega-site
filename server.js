// server.js
// Simple local backend + "getting smarter" AI simulator.
// Place your frontend (index.html) inside ./public and run: node server.js

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_FILE = path.join(__dirname, 'store.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from ./public
app.use(express.static(path.join(__dirname, 'public')));

// Helper: ensure store exists
async function ensureStore() {
  try {
    await fs.access(STORE_FILE);
  } catch (e) {
    const initial = { memories: [] };
    await fs.writeFile(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}
async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writeStore(store) {
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// Very simple tokenizer/normalizer
function words(text) {
  return (text || '').toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [];
}

// Build a naive "smart" reply using stored memories
function buildReplyFromMemories(userText, store) {
  const kws = [...new Set(words(userText))];
  if (kws.length === 0) {
    return null;
  }
  // find memory entries that share keywords (both user and assistant memories)
  const hits = [];
  for (const mem of store.memories) {
    const mwords = words(mem.text);
    for (const k of kws) {
      if (mwords.includes(k)) {
        hits.push(mem.text);
        break;
      }
    }
  }
  if (hits.length >= 2) {
    // combine two hits into a reply
    return `I remember things related to that:\n\n- ${hits[0].slice(0,200)}\n- ${hits[1].slice(0,200)}\n\nMaybe that helps?`;
  } else if (hits.length === 1) {
    return `That reminds me of this note I saved:\n\n${hits[0].slice(0,400)}\n\nWant me to remember this too?`;
  }
  return null;
}

// Fallback reply builder (echo + tiny transform)
function fallbackReply(userText) {
  // Simple transformations to avoid too-robotic echo
  if (!userText || userText.trim() === '') return "Say something and I'll try to help!";
  const qMark = userText.trim().endsWith('?') ? '' : '.';
  const trimmed = userText.trim().replace(/\s+/g, ' ');
  return `You said: "${trimmed}"${qMark}\n\nHere's a suggestion: try asking me to "remember" facts or to "explain" something. I'm learning as we chat.`;
}

// Endpoint: /api/config
app.get('/api/config', (req, res) => {
  res.json({
    provider: 'local',
    premiumAvailable: false,
    models: [
      { id: 'local-sm', label: 'local-sm (small)', premium: false },
      { id: 'local-md', label: 'local-md (learning)', premium: false }
    ]
  });
});

// Endpoint: POST /api/chat
// Expects: { modelId, temperature, system, messages, stream:true }
app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const modelId = body.modelId || 'local-sm';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser ? (lastUser.content || '') : '';

    await ensureStore();
    const store = await readStore();

    // The "learning" step: store user message to memories (simple)
    if (userText && userText.trim().length > 0) {
      store.memories.push({
        role: 'user',
        text: userText,
        ts: Date.now()
      });
    }

    // Build a reply using memories, else fallback
    let reply = buildReplyFromMemories(userText, store);
    if (!reply) {
      reply = fallbackReply(userText);
    }

    // Save assistant reply back into store (so future chats can use it)
    store.memories.push({
      role: 'assistant',
      text: reply,
      ts: Date.now()
    });

    await writeStore(store);

    // STREAM the reply back in markdown/plain text chunks to match your frontend
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // this header helps chunked streaming in many setups
    res.setHeader('Transfer-Encoding', 'chunked');
    // Allow preflight (if needed)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.flushHeaders && res.flushHeaders();

    // create some readable chunks to simulate streaming
    // we'll break reply into paragraphs and send each after a short delay
    const paragraphs = reply.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    for (const p of paragraphs) {
      res.write(p + "\n\n");
      // small delay to allow frontend to render the stream progressively
      await new Promise(r => setTimeout(r, 300));
    }
    res.end();
  } catch (err) {
    console.error('chat error', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// OPTIONS handler for preflight
app.options('/api/chat', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log(`Local demo server running at http://localhost:${PORT}`);
  console.log(`Put your index.html inside ./public and open http://localhost:${PORT}`);
});
