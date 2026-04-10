"""
models/g05_nano.py - GenAI g0.5-nano
Command-first nano profile with ultra-light Ollama settings.
"""

import math
import re
from datetime import datetime


MODEL_ID = "g0.5-nano"
MODEL_VERSION = "0.26.2.0"
OLLAMA_MODEL = "llama3.2:1b"
OLLAMA_MODELS = ["llama3.2:1b", "llama3.2:3b", "llama3.2", "llama3", "llama3:latest"]
MAX_TOKENS = 32
TEMPERATURE = 0.25
TOP_K = 10
TOP_P = 0.70
OLLAMA_OPTIONS = {
    "num_ctx": 384,
    "num_thread": 2,
}

SYSTEM_PROMPT = (
    "You are GenAI g0.5-nano in compact mode. "
    "Reply in plain text using one short sentence. "
    "Keep output direct and concise."
)

SAFE_MATH = {
    "sqrt": math.sqrt,
    "abs": abs,
    "round": round,
    "floor": math.floor,
    "ceil": math.ceil,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log2": math.log2,
    "log10": math.log10,
    "pi": math.pi,
    "e": math.e,
    "pow": math.pow,
}


def _solve_math(expr):
    clean = re.sub(r"[^0-9+\-*/().^ a-zA-Z_]", "", expr).strip().replace("^", "**")
    if not clean:
        return None
    try:
        result = eval(clean, {"__builtins__": {}}, SAFE_MATH)
        return f"Result: {result}"
    except Exception:
        return None


def _handle_command(prompt):
    text = prompt.strip()
    if not text.startswith("/"):
        return None
    lower = text.lower()
    if lower in ("/help", "/commands"):
        return "Commands: /time, /date, /calc <expr>, /ping, /about"
    if lower == "/time":
        return datetime.now().strftime("%H:%M")
    if lower == "/date":
        return datetime.now().strftime("%A, %B %d %Y")
    if lower.startswith("/calc"):
        expr = text[5:].strip()
        solved = _solve_math(expr)
        return solved or "Usage: /calc 12*(4+1)"
    if lower == "/ping":
        return "pong"
    if lower == "/about":
        return "g0.5-nano: command-first, minimal tokens, fastest profile."
    return "Unknown command. Use /help."


def rule_response(prompt):
    cmd = _handle_command(prompt)
    if cmd:
        return {"intent": "command", "response": cmd}

    lower = prompt.lower()
    if re.search(r"\b(time|date|today|what day)\b", lower):
        return {"intent": "time", "response": datetime.now().strftime("%H:%M | %A, %B %d %Y")}
    if re.search(r"\b(calculate|compute|solve|what is)\b", lower):
        solved = _solve_math(prompt)
        if solved:
            return {"intent": "math", "response": solved}

    return {
        "intent": "offline",
        "response": "Nano model unavailable. Use /help commands or reconnect remote Ollama.",
    }
