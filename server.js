// server.js
import express from 'express';
import morgan from 'morgan';
import { Readable } from 'stream';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

// Map frontend model IDs -> Ollama model names you downloaded with `ollama pull`
const MODEL_REGISTRY = {
  "gomega-4o":      { model: "moonshotai/Kimi-K2-Instruct", premium: false },
  "gomega-4o-mini": { model: "small-model/local-instruct",      premium: false },
  "gomega3.1":      { model: "llama/3.1-placeholder",           premium: false },
  "gomega5o":       { model: "gpt-5o-placeholder",             premium: true  }
};

app.options('/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.get('/config', (req, res) => {
  const models = Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
    id,
    label: id + (info.premium ? ' (premium)' : ''),
    premium: !!info.premium
  }));
  res.json({ models, premiumAvailable: false, provider: 'ollama-local' });
});

app.post('/chat', async (req, res) => {
  try {
    const { modelId, messages = [], temperature = 0.7, system } = req.body || {};
    if (!modelId) return res.status(400).json({ error: 'modelId required' });
    const entry = MODEL_REGISTRY[modelId];
    if (!entry) return res.status(400).json({ error: 'unknown modelId' });
    // Build payload for Ollama
    const payload = {
      model: entry.model,
      messages: [ ...(system ? [{ role: 'system', content: system }] : []), ...messages ],
      stream: true,
      options: { temperature: Number(temperature) || 0.7 }
    };

    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => null);
      console.error('Ollama upstream error', upstream.status, txt);
      return res.status(502).json({ error: 'Ollama upstream error', status: upstream.status, detail: txt });
    }

    // Convert native web ReadableStream to Node Readable and pipe to response
    const nodeStream = Readable.fromWeb(upstream.body);

    // Set response headers for streaming and CORS
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-transform');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Pipe the upstream stream directly to the client response
    nodeStream.pipe(res);
    nodeStream.on('error', (err) => {
      console.error('stream error', err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

  } catch (err) {
    console.error('server error', err);
    if (!res.headersSent) return res.status(500).json({ error: 'server error', message: String(err) });
    else res.end();
  }
});

app.listen(PORT, () => console.log(`Gomega AI Node proxy listening on :${PORT} (ollama at ${OLLAMA_BASE_URL})`));
