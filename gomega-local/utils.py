# utils.py
import json
import os
import time
import hmac, hashlib
from math import floor

def save_vocab(vocab, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False)

def load_vocab(path):
    import json
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

# simple time-based rotating key (12-hour window)
def expected_key(secret: str):
    # secret: server secret string
    window = 12*60*60
    t = int(time.time() // window)
    hm = hmac.new(secret.encode(), str(t).encode(), hashlib.sha256).hexdigest()
    return hm[:16]
