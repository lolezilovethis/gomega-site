# serve.py
import os
import json
import argparse
from flask import Flask, request, jsonify, Response
import torch
from model import TinyGPT
from utils import load_vocab, expected_key
import time

app = Flask("gomega_local")

# In-memory "memories"
MEMORIES = []

def load_checkpoint(path):
    d = torch.load(path, map_location="cpu")
    config = d.get("config", {})
    vocab = d.get("vocab")
    model = TinyGPT(vocab_size=vocab["vocab_size"],
                    block_size=config.get("block_size", 128),
                    embed_dim=config.get("embed_dim", 256),
                    n_layers=config.get("n_layers", 6),
                    n_heads=config.get("n_heads", 4))
    model.load_state_dict(d["model_state"])
    model.eval()
    return model, vocab, config

@app.route("/config", methods=["GET"])
def config():
    return jsonify({
        "models": [
            {"id": "gomega-5", "label": "gomega-5 (local small)"},
        ],
        "provider": "local",
        "premiumAvailable": False
    })

@app.route("/key", methods=["GET"])
def key():
    # simple exposed key (first 8 chars of expected_key to match the UI length)
    secret = os.environ.get("GOMEGA_SECRET", "default_secret_changeme")
    key = expected_key(secret)[:16]
    return jsonify({"key": key})

@app.route("/verify-key", methods=["POST"])
def verify():
    j = request.get_json() or {}
    k = j.get("key", "")
    secret = os.environ.get("GOMEGA_SECRET", "default_secret_changeme")
    ok = (k == expected_key(secret)[:16])
    return jsonify({"valid": bool(ok)})

@app.route("/memories", methods=["GET"])
def memories():
    # return last 50 memories
    return jsonify({"memories": [{"role":m["role"], "text": m["text"]} for m in MEMORIES[-50:]]})

@app.route("/chat", methods=["POST"])
def chat():
    # Expected body:
    # { modelId, temperature, system, messages: [{role, content}, ...], stream? }
    try:
        data = request.get_json()
        modelId = data.get("modelId")
        temp = float(data.get("temperature", 0.7))
        system = data.get("system", "")
        messages = data.get("messages", [])
    except Exception as e:
        return jsonify({"error": "bad request"}), 400

    # Build single prompt string: system + conversation
    prompt_parts = []
    if system:
        prompt_parts.append(system.strip())
    for m in messages[-20:]:
        role = m.get("role")
        content = m.get("content", "")
        if role == "user":
            prompt_parts.append("User: " + content)
        else:
            prompt_parts.append("Assistant: " + content)
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    # Encode using vocab
    input_ids = [vocab["stoi"].get(ch, 0) for ch in prompt]  # unknown -> 0
    import torch
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    idx = torch.tensor([input_ids], dtype=torch.long, device=device)

    # generate up to N tokens
    max_new = 200
    model.to(device)
    with torch.no_grad():
        out = model.generate(idx, max_new_tokens=max_new, temperature=temp, top_k=40, device=device)
    # decode reply: consider everything after original length
    generated_ids = out[0].tolist()
    reply_ids = generated_ids[len(input_ids):]
    reply = "".join([vocab["itos"].get(str(i), vocab["itos"].get(i, "?")) if isinstance(vocab["itos"].get(i), str) else vocab["itos"].get(i, "?") for i in reply_ids])
    # fallback decode (vocab loaded with ints keys)
    if reply.strip()=="":
        # attempt mapping with int keys
        try:
            reply = "".join([vocab["itos"][i] for i in reply_ids])
        except Exception:
            pass

    # store memory
    MEMORIES.append({"role":"assistant", "text": reply})

    # Return JSON with text field (ai.html's client will parse this)
    return jsonify({"text": reply})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt", default="checkpoint.pt")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    assert os.path.exists(args.ckpt), "checkpoint.pt not found. Run train.py first."

    print("Loading model...")
    model, vocab, config = load_checkpoint(args.ckpt)
    # attach to global for handlers
    globals().update({"model": model, "vocab": vocab, "config": config})
    print("Model loaded. Starting server.")
    app.run(host=args.host, port=args.port)
