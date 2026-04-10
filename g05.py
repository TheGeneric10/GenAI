"""
models/g05.py — GenAI g0.5
Professional & coding-focused model.
Handles: high to very high prompts.

Model Spec:
  Level      : High → Very High
  Engine     : Ollama llama3 (primary) + ThinkingMini V0.3 for complex prompts
  Token cap  : 400 tokens
  Temp       : 0.65 (lower = more precise)
  Top-k      : 50
  Use case   : Coding, smart strategies, professional workspace,
               moderate-to-high reasoning tasks

ThinkingMini V0.3:
  Triggered automatically when prompt complexity score >= threshold.
  Adds a brief "thinking" prefix in the system prompt to encourage
  step-by-step reasoning before the final answer.
  NOT for ultimate/heavy production tasks.
"""

MODEL_ID      = "g0.5"
MODEL_VERSION = "0.26.2.0"
OLLAMA_MODEL  = "llama3"
MAX_TOKENS    = 400
TEMPERATURE   = 0.65
TOP_K         = 50
TOP_P         = 0.92

# ── ThinkingMini V0.3 ──────────────────────────────────────────────────────────
# Triggered on complex prompts. Encourages brief reasoning before answer.

THINKING_TRIGGER_SCORE = 4  # complexity score threshold

THINKING_KEYWORDS = [
    "explain", "why", "how does", "compare", "difference between",
    "implement", "algorithm", "debug", "fix", "error", "optimize",
    "design", "architecture", "strategy", "analyze", "what if",
    "pros and cons", "tradeoff", "step by step", "write a function",
    "class", "recursive", "complexity", "big o", "refactor",
]

def complexity_score(prompt):
    """Score prompt complexity 0-10. Higher = more complex."""
    p = prompt.lower()
    score = 0
    score += min(len(prompt.split()) // 8, 3)          # word count
    for kw in THINKING_KEYWORDS:
        if kw in p:
            score += 1
    score += prompt.count("?")                          # question marks
    score += 1 if any(c in prompt for c in ["```","def ","class ","import "]) else 0
    return score

SYSTEM_PROMPT_BASE = (
    "You are GenAI g0.5, a professional and coding-capable assistant. "
    "You handle coding questions, smart strategies, and professional workspace needs. "
    "Be precise, structured, and clear. "
    "You can write real code with proper formatting. "
    "Keep responses focused — not for heavy production or ultimate-level tasks."
)

SYSTEM_PROMPT_THINKING = (
    "You are GenAI g0.5 with ThinkingMini V0.3 active. "
    "This is a complex prompt. Before answering, briefly reason through it in 1-2 sentences, "
    "then give your structured response. "
    "You handle coding, professional strategies, and moderate-to-high reasoning. "
    "Be precise. Write clean code when needed. Not for ultimate-level heavy tasks."
)

def get_system_prompt(prompt):
    """Return appropriate system prompt based on complexity."""
    score = complexity_score(prompt)
    if score >= THINKING_TRIGGER_SCORE:
        return SYSTEM_PROMPT_THINKING, True   # (prompt, thinking_active)
    return SYSTEM_PROMPT_BASE, False

# ── Fallback rule response ─────────────────────────────────────────────────────
import re, math
from datetime import datetime

SAFE_MATH = {
    "sqrt": math.sqrt, "abs": abs, "round": round,
    "floor": math.floor, "ceil": math.ceil,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "log": math.log, "log2": math.log2, "log10": math.log10,
    "pi": math.pi, "e": math.e, "pow": math.pow,
}

def rule_response(prompt):
    """Minimal fallback when Ollama is offline."""
    expr = re.sub(r"(what is|calculate|compute|solve|evaluate)", "", prompt, flags=re.IGNORECASE)
    expr = re.sub(r"[^0-9+\-*/().^ a-zA-Z_]", "", expr).strip().replace("^", "**")
    try:
        result = eval(expr, {"__builtins__": {}}, SAFE_MATH)
        return {"intent": "math", "response": f"Result: {result}"}
    except Exception:
        pass
    return {"intent": "offline", "response": "Ollama is offline. g0.5 requires Ollama for full functionality."}