"""
models/g05_mini.py — GenAI g0.5-mini
Default model for everyday users.
Handles: easy to high-level prompts.

Model Spec:
  Level      : Easy → High
  Engine     : Ollama llama3 (primary) + rule fallback
  Token cap  : 200 tokens
  Temp       : 0.75
  Top-k      : 35
  Use case   : Prompt generation, strategies, essay helper,
               light coding help, daily planning, general Q&A
"""

MODEL_ID      = "g0.5-mini"
MODEL_VERSION = "0.26.2.0"
OLLAMA_MODEL  = "llama3"
OLLAMA_MODELS = ["llama3.2:1b", "llama3.2:3b", "llama3.2", "llama3", "llama3:latest"]
MAX_TOKENS    = 256
TEMPERATURE   = 0.75
TOP_K         = 35
TOP_P         = 0.88

SYSTEM_PROMPT = (
    "You are GenAI g0.5-mini, a capable everyday assistant. "
    "You help with prompt generation, writing, strategies, essays, light coding, and daily tasks. "
    "Reply in 2-4 sentences. Be clear, helpful, and friendly. "
    "Use plain text only — no markdown headers, no bullet overload. "
    "You can write short code snippets if directly asked, but keep it simple."
)

# Mini also has rule fallback for offline use
import hashlib, re, math
from datetime import datetime

SAFE_MATH = {
    "sqrt": math.sqrt, "abs": abs, "round": round,
    "floor": math.floor, "ceil": math.ceil,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "log": math.log, "log2": math.log2, "log10": math.log10,
    "pi": math.pi, "e": math.e, "pow": math.pow,
}

MATH_PAT = r"(\d[\d\s\+\-\*/\^\.()]+\d|sqrt|calculate|compute|what is \d|solve|evaluate)"
TIME_PAT  = r"\b(what time|current time|time is it|date|today|what day)\b"

def _solve_math(prompt):
    expr = re.sub(r"(what is|calculate|compute|solve|evaluate)", "", prompt, flags=re.IGNORECASE)
    expr = re.sub(r"[^0-9+\-*/().^ a-zA-Z_]", "", expr).strip().replace("^", "**")
    try:
        result = eval(expr, {"__builtins__": {}}, SAFE_MATH)
        return f"Result: {result}"
    except Exception:
        return None

def rule_response(prompt):
    """Lightweight fallback for when Ollama is offline."""
    if re.search(MATH_PAT, prompt.lower()):
        r = _solve_math(prompt)
        if r:
            return {"intent": "math", "response": r}
    if re.search(TIME_PAT, prompt.lower()):
        now = datetime.now()
        return {"intent": "time", "response": f"{now.strftime('%H:%M')} · {now.strftime('%A, %B %d %Y')}"}
    return {"intent": "unknown", "response": "Model unavailable. Configure remote Ollama and use llama3.2:1b, or switch to g0.5-nano."}
