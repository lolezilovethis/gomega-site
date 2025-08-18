# Gomega Local — train & serve a small GPT (no Hugging Face)

## Setup
1. Put your training text in `data.txt` (plain text). The more and cleaner data, the better.
2. Create a Python virtualenv and install requirements:
   ```bash
   python -m venv .venv
   source .venv/bin/activate      # or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
