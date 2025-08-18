# model.py
import math
import torch
import torch.nn as nn
import torch.nn.functional as F

class SelfAttention(nn.Module):
    def __init__(self, embed_dim, num_heads):
        super().__init__()
        assert embed_dim % num_heads == 0
        self.head_dim = embed_dim // num_heads
        self.num_heads = num_heads
        self.qkv = nn.Linear(embed_dim, embed_dim * 3)
        self.proj = nn.Linear(embed_dim, embed_dim)

    def forward(self, x, mask=None):
        B, T, C = x.shape
        qkv = self.qkv(x)  # (B,T,3*C)
        qkv = qkv.view(B, T, 3, self.num_heads, self.head_dim)
        q, k, v = qkv[:,:,0], qkv[:,:,1], qkv[:,:,2]  # each: (B,T,H,head_dim)

        # transpose to (B, H, T, head_dim)
        q = q.transpose(1,2)
        k = k.transpose(1,2)
        v = v.transpose(1,2)

        scores = (q @ k.transpose(-2,-1)) / math.sqrt(self.head_dim)  # (B,H,T,T)
        if mask is not None:
            scores = scores.masked_fill(mask==0, float('-inf'))
        attn = F.softmax(scores, dim=-1)
        out = attn @ v  # (B,H,T,head_dim)
        out = out.transpose(1,2).contiguous().view(B, T, C)
        return self.proj(out)

class FeedForward(nn.Module):
    def __init__(self, embed_dim, hidden_mult=4, dropout=0.0):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(embed_dim, embed_dim * hidden_mult),
            nn.GELU(),
            nn.Linear(embed_dim * hidden_mult, embed_dim),
            nn.Dropout(dropout)
        )
    def forward(self, x):
        return self.net(x)

class TransformerBlock(nn.Module):
    def __init__(self, embed_dim, num_heads, dropout=0.0):
        super().__init__()
        self.ln1 = nn.LayerNorm(embed_dim)
        self.attn = SelfAttention(embed_dim, num_heads)
        self.ln2 = nn.LayerNorm(embed_dim)
        self.ff = FeedForward(embed_dim, dropout=dropout)

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        x = x + self.ff(self.ln2(x))
        return x

class TinyGPT(nn.Module):
    def __init__(self, vocab_size, block_size=128, embed_dim=256, n_layers=6, n_heads=4):
        super().__init__()
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.tok_emb = nn.Embedding(vocab_size, embed_dim)
        self.pos_emb = nn.Embedding(block_size, embed_dim)
        self.blocks = nn.Sequential(*[TransformerBlock(embed_dim, n_heads) for _ in range(n_layers)])
        self.ln_f = nn.LayerNorm(embed_dim)
        self.head = nn.Linear(embed_dim, vocab_size, bias=False)

        # init
        self.apply(self._init_weights)

    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, idx, targets=None):
        B, T = idx.shape
        assert T <= self.block_size, f"Cannot forward with T={T} > block_size={self.block_size}"
        tok = self.tok_emb(idx)  # (B,T,C)
        pos = self.pos_emb(torch.arange(T, device=idx.device))[None, :, :]
        x = tok + pos
        x = self.blocks(x)
        x = self.ln_f(x)
        logits = self.head(x)  # (B,T,vocab)
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.view(-1, self.vocab_size), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens=128, temperature=1.0, top_k=None, device=None):
        device = device or next(self.parameters()).device
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -self.block_size:]
            logits, _ = self.forward(idx_cond)
            logits = logits[:, -1, :] / (temperature if temperature>0 else 1.0)
            if top_k is not None:
                v, _ = torch.topk(logits, top_k)
                minv = v[:, -1][:, None]
                logits = torch.where(logits < minv, torch.full_like(logits, -1e10), logits)
            probs = F.softmax(logits, dim=-1)
            next_token = torch.multinomial(probs, num_samples=1)
            idx = torch.cat([idx, next_token], dim=1)
        return idx
