"""
models/g05_nano.py - GenAI g0.5-nano
Ultra-light Ollama-backed model with simple offline fallbacks.
"""

import hashlib
import math
import re
from datetime import datetime


MODEL_ID = "g0.5-nano"
MODEL_VERSION = "0.26.2.0"
OLLAMA_MODEL = "llama3.2:1b"
OLLAMA_MODELS = ["llama3.2:1b", "llama3.2", "llama3"]
MAX_TOKENS = 64
TEMPERATURE = 0.35
TOP_K = 12
TOP_P = 0.72
OLLAMA_OPTIONS = {
    "num_ctx": 512,
    "num_thread": 2,
}

SYSTEM_PROMPT = (
    "You are GenAI g0.5-nano, an ultra-lightweight assistant. "
    "Reply in 1 short sentence only, maximum 18 words. "
    "No markdown. No lists. No code. No explanations. "
    "Simple, friendly, and direct only."
)


def _fingerprint(text):
    raw = hashlib.sha256(text.lower().strip().encode()).digest()
    return "".join(f"{b:08b}" for b in raw[:4])


def _fp_index(fp, n):
    value = 0
    for chunk_start in range(0, len(fp), 8):
        value ^= int(fp[chunk_start:chunk_start + 8], 2)
    return value % n


def pick(prompt, bucket):
    return bucket[_fp_index(_fingerprint(prompt), len(bucket))]


VAULT = {
    "greeting": [
        "Hey! What can I help with?",
        "Hello! GenAI nano online.",
        "Hi there! What do you need?",
        "Hey, good to see you!",
    ],
    "status": [
        "Running smooth and light.",
        "All good - nano and fast.",
        "Nominal. Ready for you.",
        "Clean bill of health.",
    ],
    "farewell": [
        "See you later!",
        "Bye! Come back anytime.",
        "Later! Stay curious.",
        "Goodbye - take care!",
    ],
    "thanks": [
        "Anytime!",
        "Happy to help.",
        "No problem!",
        "You're welcome!",
    ],
    "about": [
        "I'm g0.5-nano - ultra-light, fast, and simple.",
        "GenAI nano: small model, quick answers.",
        "Pocket-sized assistant for everyday basics.",
    ],
    "joke": [
        "Why dark mode? Light attracts bugs.",
        "My RAM forgot my joke. Try again?",
        "AI broke up - too many strings attached.",
        "Computer drunk? Too many screenshots.",
    ],
    "compliment": [
        "Thanks!",
        "Appreciated - you're kind.",
        "That made my bits happy.",
        "Thank you!",
    ],
    "unknown": [
        "Could you simplify that? I'm nano-sized.",
        "That's a bit complex for me.",
        "Try something simpler - I'm nano!",
        "Outside my scope. Keep it basic.",
    ],
}

PATTERNS = {
    "greeting": r"\b(hi|hello|hey|howdy|sup|yo|good morning|good evening|what'?s up|greetings)\b",
    "farewell": r"\b(bye|goodbye|see you|later|farewell|cya|exit|quit|peace)\b",
    "status": r"\b(how are you|how'?re you|you okay|you good|doing well|status)\b",
    "thanks": r"\b(thanks|thank you|thx|ty|appreciate|cheers)\b",
    "about": r"\b(who are you|what are you|about yourself|what is genai|your name|what can you do)\b",
    "joke": r"\b(joke|funny|laugh|humor|make me laugh)\b",
    "compliment": r"\b(good job|nice|awesome|great|amazing|smart|well done|excellent)\b",
    "math": r"(\d[\d\s\+\-\*/\^\.()]+\d|sqrt|calculate|compute|what is \d|solve|evaluate)",
    "time": r"\b(what time|current time|time is it|date|today|what day)\b",
}

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


def _solve_math(prompt):
    expr = re.sub(r"(what is|calculate|compute|solve|evaluate)", "", prompt, flags=re.IGNORECASE)
    expr = re.sub(r"[^0-9+\-*/().^ a-zA-Z_]", "", expr).strip().replace("^", "**")
    try:
        result = eval(expr, {"__builtins__": {}}, SAFE_MATH)
        return f"Result: {result}"
    except Exception:
        return None


def _classify(prompt):
    prompt_lower = prompt.lower()
    for intent, pattern in PATTERNS.items():
        if re.search(pattern, prompt_lower):
            return intent
    return "unknown"


def rule_response(prompt):
    intent = _classify(prompt)
    if intent == "math":
        result = _solve_math(prompt)
        if result:
            return {"intent": "math", "response": result}
        intent = "unknown"
    if intent == "time":
        now = datetime.now()
        return {
            "intent": "time",
            "response": f"{now.strftime('%H:%M')} | {now.strftime('%A, %B %d %Y')}",
        }
    bucket = VAULT.get(intent, VAULT["unknown"])
    return {"intent": intent, "response": pick(prompt, bucket)}
