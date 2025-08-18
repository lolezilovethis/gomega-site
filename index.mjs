// index.mjs - Cloudflare Worker using Hugging Face Router (OpenAI-compatible)
// Secrets expected: HF_TOKEN, optional PREMIUM_KEY

const MODEL_REGISTRY = {
  // Replace these hf values with the actual HF model repo IDs you want to use
  "gomega-4o":      { hf: "moonshotai/Kimi-K2-Instruct", premium: false },
  "gomega-4o-mini": { hf: "tiiuae/falcon-7b-instruct",    premium: false },
  "gomega3.1":      { hf: "meta-llama/Llama-2-7b-chat",   premium: false }, // example; replace if needed
  "gomega5o":       { hf: "big-model-owner/gpt-5o-like",  premium: true  }  // premium placeholder
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (request.method === "GET" && (path === "/config" || path === "/api/config")) {
      const models = Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
        id,
        label: id + (info.premium ? " (premium)" : ""),
        premium: !!info.premium
      }));
      const premiumAvailable = !!env.PREMIUM_KEY;
      return jsonResponse({ models, premiumAvailable, provider: "huggingface-router" });
    }

    if (request.method === "POST" && (path === "/chat" || path === "/api/chat")) {
      if (!env.HF_TOKEN) {
        return jsonResponse({ error: "Missing HF_TOKEN secret on the Worker" }, 500);
      }

      const body = await request.json().catch(() => null);
      if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

      const { modelId, messages = [], temperature = 0.7, system } = body;
      if (!modelId) return jsonResponse({ error: "modelId required" }, 400);

      const entry = MODEL_REGISTRY[modelId];
      if (!entry) return jsonResponse({ error: "unknown modelId" }, 400);
      if (entry.premium && !env.PREMIUM_KEY) return jsonResponse({ error: "Model requires premium access" }, 402);

      const routerUrl = "https://router.huggingface.co/v1/chat/completions";

      // Build messages in OpenAI-compatible chat format
      const hfMessages = [];
      if (system) hfMessages.push({ role: "system", content: system });
      for (const m of messages) hfMessages.push({ role: m.role || "user", content: m.content });

      const payload = {
        model: entry.hf,
        messages: hfMessages,
        temperature: Number(temperature) || 0.7,
        stream: true,
        max_tokens: 512
      };

      const upstream = await fetch(routerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.HF_TOKEN}`
        },
        body: JSON.stringify(payload)
      });

      if (!upstream.ok || !upstream.body) {
        const t = await upstream.text().catch(() => null);
        return jsonResponse({ error: "Hugging Face upstream error", status: upstream.status, detail: t }, 502);
      }

      const headers = new Headers(upstream.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Content-Type", "text/plain; charset=utf-8");

      return new Response(upstream.body, { status: 200, headers });
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
