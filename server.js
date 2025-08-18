// server.js
// Simple Express server that serves static files from ./public
// and exposes a test API under /api:
//  - GET  /api/config
//  - POST /api/chat   (streaming via SSE or non-streaming JSON fallback)
//  - GET  /api/memories
//
// Run: node server.js
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors()); // Allow requests from the browser during dev
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;

// In-memory memory store for demo/testing
const MEMORY_LIMIT = 200;
const memories = []; // each entry: { role: 'user'|'assistant', text, ts }

// Models exposed to the frontend
const MODELS = [
  { id: 'gomega-5', label: 'gomega-5 (best)' },
  { id: 'gomega-4o', label: 'gomega-4o (balanced)' },
  { id: 'gomega-4mini', label: 'gomega-4mini (small)' },
  { id: 'gomega-3.0', label: 'gomega-3.0 (legacy)' },
  { id: 'gomega-3mini', label: 'gomega-3mini (fast)' },
  { id: 'local-sm', label: 'local-sm (fast)' },
];

// Serve static frontend from ./public
app.use(express.static(path.join(__dirname, 'public')));

/**
 * GET /api/config
 * Return a small JSON config describing provider, available models, etc.
 */
app.get('/api/config', (req, res) => {
  res.json({
    provider: 'local-test',
    premiumAvailable: false,
    models: MODELS,
    // optional hint for the frontend
    info: 'This is a local test backend. POST /api/chat to test chat (streaming supported).'
  });
});

/**
 * Helper: append memory (bounded)
 */
function pushMemory(role, text) {
  memories.push({ role, text: String(text || ''), ts: Date.now() });
  while (memories.length > MEMORY_LIMIT) memories.shift();
}

/**
 * POST /api/chat
 * - If client expects streaming (SSE), we will send text/event-stream with `data: ...` chunks.
 * - If client explicitly requests JSON (query ?stream=false or Accept: application/json), returns a simple JSON response.
 *
 * Request body (JSON) format expected (from the frontend):
 * { modelId, temperature, system, messages, stream:true }
 *
 * This test implementation simply echos/acknowledges the last user message,
 * and simulates chunked output for streaming clients.
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { modelId = 'gomega-5', temperature = 0.7, system, messages = [], stream = true } = req.body || {};

    // extract last user message for the demo reply
    const last = Array.isArray(messages) ? messages.slice(-1)[0] : null;
    const userText = last && last.content ? String(last.content) : '';

    // record incoming message into memory (basic)
    if (userText) pushMemory('user', userText);

    // Create a simple reply text
    const replyText = `Gomega (${modelId}) — reply from local test backend:\n\n` +
      `Received message: "${userText}"\n\n` +
      `This is a demo response from the local test server. Temperature: ${temperature}`;

    // If client explicitly asked for non-streaming JSON, respond with JSON
    const wantJson = req.query.stream === 'false' ||
      (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1);

    if (wantJson) {
      // save assistant memory and return JSON
      pushMemory('assistant', replyText);
      return res.json({
        choices: [{ text: replyText }],
        reply: replyText
      });
    }

    // Otherwise: streaming via SSE (text/event-stream)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    // a helper to send a data event (SSE)
    const sendData = (data) => {
      // data should be plain text; encode and send as `data: <text>\n\n`
      // ensure we escape lines by sending each line as its own data: line
      const lines = String(data).split(/\r?\n/);
      for (const line of lines) {
        res.write(`data: ${line}\n`);
      }
      res.write(`\n`); // event separator
    };

    // simulate a progressive streaming of the reply
    // split reply into chunks and send them at intervals
    const full = replyText;
    const CHUNK_SIZE = 40; // approx chars per chunk (tweak if you want faster/slower)
    let idx = 0;

    // initial small wait to simulate processing
    sendData('[STREAM-BEGIN]');
    const interval = setInterval(() => {
      if (idx >= full.length) {
        // final event indicating end (clients may ignore)
        sendData('[DONE]');
        clearInterval(interval);
        // Save final assistant text to memory
        pushMemory('assistant', full);
        // end the response after a brief delay to ensure client receives final chunk
        setTimeout(() => {
          try { res.end(); } catch (e) { /* ignore */ }
        }, 30);
        return;
      }
      const chunk = full.slice(idx, idx + CHUNK_SIZE);
      idx += CHUNK_SIZE;
      sendData(chunk);
    }, 40); // send every 40ms (adjust to taste)

    // if client closes connection, stop the interval
    req.on('close', () => {
      clearInterval(interval);
    });

  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: 'server error', detail: String(err) });
  }
});

/**
 * GET /api/memories
 * Return last saved memories (for demo / debugging)
 */
app.get('/api/memories', (req, res) => {
  res.json({
    count: memories.length,
    memories: memories.slice(-100).map(m => ({ role: m.role, text: m.text, ts: m.ts }))
  });
});

// Fallback for single-page or dev: serve index (if needed)
// (But we already serve static public files above.)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai.html'));
});

// start server
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Serving ./public (place your ai.html there).`);
  console.log(`API endpoints: GET /api/config  POST /api/chat  GET /api/memories`);
});
