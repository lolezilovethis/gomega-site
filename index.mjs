// index.mjs
// Cloudflare Worker: simple proxy between your frontend and Hugging Face Inference API
// - Exposes GET /config  -> list of models + premium flag
// - Exposes POST /chat  -> accepts { modelId, messages, temperature, system, stream }
//   and proxies to Hugging Face Inference API, streaming the response back to the browser.
// Secrets expected (set via wrangler secret put):
// - HF_API_TOKEN  (required)  -> Hugging Face API token
// - PREMIUM_KEY   (optional)  -> any secret that enables premium model use
//
// IMPORTANT:
// Replace HF_MODEL_MAP values with the HF model repo IDs you want to use.
// Some models on Hugging Face require a license or a paid plan—choose models you are allowed to use.

const MODEL_REGISTRY = {
  // friendlyId: { hf: "<huggingface-model-id>", premium: bool }
  "gomega-4o":     { hf: "your-hf-model-id-for-gomega-4o",     premium: false },
  "gomega-4o-mini":{ hf: "your-hf-model-id-for-gomega-4o-mini",premium: false },
  "gomega3.1":     { hf: "your-hf-model-id-for-gomega3.1",     premium: false },
  "gomega5o":      { hf: "your-hf-model-id-for-gomega5o",      premium: true  } // premium gated
};

function jsonResponse(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type" }
  });
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight handling (so browser can POST from your GitHub Pages site)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ""); // trim trailing slash

    try {
      if (request.method === "GET" && (path === "/config" || path === "/api/config")) {
        // Return models & whether premium is available (based on presence of PREMIUM_KEY secret)
        const models = Object.entries(MODEL_REGISTRY).map(([id, info]) => ({
          id,
          label: id + (info.premium ? " (premium)" : ""),
          premium: !!info.premium
        }));
        const premiumAvailable = !!env.PREMIUM_KEY; // set via wrangler secret put PREMIUM_KEY
        return jsonResponse({ models, premiumAvailable, provider: "huggingface" });
      }

      if (request.method === "POST" && (path === "/chat" || path === "/api/chat")) {
        if (!env.HF_API_TOKEN) {
          return jsonResponse({ error: "Missing Hugging Face API token on the Worker (HF_API_TOKEN)" }, 500);
        }

        const body = await request.json().catch(()=>null);
        if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

        const { modelId, messages = [], temperature = 0.7, system } = body;
        if (!modelId) return jsonResponse({ error: "modelId required" }, 400);
        const reg = MODEL_REGISTRY[modelId];
        if (!reg) return jsonResponse({ error: "unknown modelId" }, 400);
        if (reg.premium && !env.PREMIUM_KEY) return jsonResponse({ error: "Model requires premium access" }, 402);

        // Convert messages array into a single prompt string (simple chat -> transcript)
        // messages expected as [{role:'user'|'assistant', content:'...'}, ...]
        let prompt = "";
        if (system) prompt += `System: ${system}\n\n`;
        for (const m of messages) {
          const r = (m.role || "user").toLowerCase();
          if (r === "user") prompt += `User: ${m.content}\n`;
          else if (r === "assistant") prompt += `Assistant: ${m.content}\n`;
          else prompt += `${r}: ${m.content}\n`;
        }
        // Add final assistant prefix so some chat models respond as assistant
        prompt += `Assistant:`;

        // Compose HF API request
        // Many HF models accept: POST https://api-inference.huggingface.co/models/{model}
        const hfUrl = `https://api-inference.huggingface.co/models/${reg.hf}`;

        // Body uses `inputs` + optional parameters. We ask HF to stream if available.
        const hfPayload = {
          inputs: prompt,
          parameters: { temperature: Number(temperature) || 0.7, max_new_tokens: 512 },
          options: { wait_for_model: true, use_cache: false, stream: true }
        };

        // Forward request to Hugging Face with your token
        const upstream = await fetch(hfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.HF_API_TOKEN}`
          },
          body: JSON.stringify(hfPayload),
        });

        if (!upstream.ok) {
          const t = await upstream.text().catch(()=>null);
          return jsonResponse({ error: "Hugging Face upstream error", status: upstream.status, detail: t }, 502);
        }

        // Stream response body back to the client by returning the upstream body directly.
        // We set response headers for CORS and text/plain so frontend can append chunks.
        const headers = new Headers(upstream.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        // Normalise content-type; frontend expects plain text chunks
        headers.set("Content-Type", "text/plain; charset=utf-8");

        // Return the upstream ReadableStream directly so browser receives streaming tokens
        return new Response(upstream.body, { status: 200, headers });
      }

      // Not found
      return jsonResponse({ error: "Not found" }, 404);

    } catch (err) {
      return jsonResponse({ error: "worker error", message: String(err) }, 500);
    }
  }
};
