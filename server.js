// server.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: false }));

// PROVIDER: 'ollama' (default). You can extend to other local providers later.
const PROVIDER = process.env.PROVIDER || 'ollama';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// Premium gate: set PREMIUM=true to allow premium model use (gomega5o)
const PREMIUM_ENABLED = (process.env.PREMIUM === 'true') || !!process.env.PREMIUM_KEY;

// Map your brand-names -> provider model names
const MODEL_REGISTRY = {
  'gomega-4o': { providerModel: 'gpt-4o', premium: false },
  'gomega-4o-mini': { providerModel: 'gpt-4o-mini', premium: false },
  'gomega3.1': { providerModel: 'llama3.1', premium: false },
  'gomega5o': { providerModel: 'gpt-5o', premium: true }
};

// Provide frontend with models + premium flag
app.get('/config', (req, res) => {
  const models = Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
    id,
    label: id + (info.premium ? ' (premium)' : ''),
    premium: !!info.premium
  }));
  res.json({ models, premiumAvailable: PREMIUM_ENABLED, provider: PROVIDER });
});

// Main chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const {
      modelId,
      messages = [],
      temperature = 0.7,
      system,
      stream = true
    } = req.body || {};

    if (!modelId) return res.status(400).json({ error: 'modelId required' });
    const modelInfo = MODEL_REGISTRY[modelId];
    if (!modelInfo) return res.status(400).json({ error: 'unknown modelId' });
    if (modelInfo.premium && !PREMIUM_ENABLED) {
      return res.status(402).json({ error: 'Model requires premium access' });
    }

    // For now we only support Ollama (self-hosted). Extend this switch for other local providers later.
    if (PROVIDER !== 'ollama') {
      return res.status(500).json({ error: 'Only Ollama provider is configured on this server' });
    }

    // Ollama chat streaming API
    const payload = {
      model: modelInfo.providerModel,
      messages: [ ...(system ? [{ role: 'system', content: system }] : []), ...messages ],
      stream: stream === true,
      options: { temperature }
    };

    // Initiate request to Ollama
    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(()=>null);
      console.error('Ollama error', upstream.status, text);
      return res.status(502).json({ error: 'Ollama upstream error' });
    }

    // Stream back plain text chunks (frontend expects text chunks that are concatenated)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    // Some proxies require these:
    res.setHeader('Cache-Control', 'no-transform');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    // Ollama typically streams newline-delimited JSON objects. We'll parse chunk-by-chunk and
    // write text tokens when found.
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // split into lines (handle partial lines)
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        // Ollama often sends JSON lines; try to parse and extract message content
        try {
          const obj = JSON.parse(line);
          // Different versions can package the text in different places; be permissive:
          // check obj.message.content or obj.output_text or obj.token
          let out = '';
          if (obj.message && typeof obj.message.content === 'string') out = obj.message.content;
          else if (typeof obj.output_text === 'string') out = obj.output_text;
          else if (obj.token) out = String(obj.token);
          else if (obj.text) out = String(obj.text);

          if (out) {
            res.write(out);
          }
        } catch (e) {
          // If not JSON, write line raw (best-effort)
          res.write(line + '\n');
        }
      }
    }

    // flush any leftover buffer (best-effort)
    if (buffer) {
      try {
        const obj = JSON.parse(buffer);
        if (obj.message && obj.message.content) res.write(obj.message.content);
      } catch {
        res.write(buffer);
      }
    }

    res.end();
  } catch (err) {
    console.error('server error', err);
    if (!res.headersSent) res.status(500).json({ error: 'server error' });
    else res.end();
  }
});

app.listen(PORT, () => console.log(`Gomega AI server on :${PORT} (provider=${PROVIDER})`));
