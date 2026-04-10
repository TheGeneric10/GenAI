"""
ai.py - GenAI Core Router v0.26.2.0
Routes prompts to the selected model and queries remote Ollama first.
Falls back to lightweight rule handlers if Ollama is unavailable.
"""

import os
import sys
from ollama import Client


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "models"))

import g05 as pro
import g05_mini as mini
import g05_nano as nano


def _normalize_ollama_base_url(raw_url):
    base = (raw_url or "").strip().rstrip("/")
    if not base:
        return ""
    if "/api/" in base:
        return base.split("/api/", 1)[0]
    return base


OLLAMA_BASE_URL = _normalize_ollama_base_url(os.getenv("OLLAMA_BASE_URL"))
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "").strip()
OLLAMA_AUTH_SCHEME = os.getenv("OLLAMA_AUTH_SCHEME", "Bearer").strip()
OLLAMA_KEY_HEADER = os.getenv("OLLAMA_KEY_HEADER", "Authorization").strip()
OLLAMA_DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:120b-cloud").strip() or "gpt-oss:120b-cloud"
GENAI_MAX_PROMPT_CHARS = int(os.getenv("GENAI_MAX_PROMPT_CHARS", "2000"))
GENAI_MAX_HISTORY_MESSAGES = int(os.getenv("GENAI_MAX_HISTORY_MESSAGES", "12"))
GENAI_DETERMINISTIC_SEED = int(os.getenv("GENAI_DETERMINISTIC_SEED", "42"))
LAST_OLLAMA_ERROR = ""

MODELS = {
    "g0.5-nano": nano,
    "g0.5-mini": mini,
    "g0.5": pro,
}

DEFAULT_MODEL = "g0.5-mini"


def _system_prompt_override_for_model(model_id):
    env_key = "GENAI_PROMPT_" + model_id.replace(".", "").replace("-", "_").upper()
    return os.getenv(env_key, "").strip()


def _build_ollama_headers():
    headers = {}
    if OLLAMA_API_KEY:
        if OLLAMA_KEY_HEADER.lower() == "authorization":
            headers["Authorization"] = f"{OLLAMA_AUTH_SCHEME} {OLLAMA_API_KEY}".strip()
        else:
            headers[OLLAMA_KEY_HEADER] = OLLAMA_API_KEY
    return headers


def _get_ollama_client():
    if not OLLAMA_BASE_URL:
        return None
    return Client(host=OLLAMA_BASE_URL, headers=_build_ollama_headers())


def ollama_health_check(timeout=2):
    if not OLLAMA_BASE_URL:
        return False
    try:
        client = _get_ollama_client()
        if client is None:
            return False
        client.list()
        return True
    except Exception:
        return False


def _fetch_ollama_tags(timeout=6):
    if not OLLAMA_BASE_URL:
        return []
    try:
        client = _get_ollama_client()
        if client is None:
            return []
        data = client.list()
        models = data.get("models", []) if isinstance(data, dict) else []
        return [m.get("name", "") for m in models if isinstance(m, dict) and m.get("name")]
    except Exception:
        return []


def model_health_report():
    tags = _fetch_ollama_tags()
    tag_set = set(tags)
    report = {
        "ollama_base_url": OLLAMA_BASE_URL or "not_configured",
        "ollama_model": OLLAMA_DEFAULT_MODEL,
        "ollama_configured": bool(OLLAMA_BASE_URL),
        "ollama_reachable": ollama_health_check(timeout=2),
        "available_tags": tags,
        "limits": {
            "max_prompt_chars": GENAI_MAX_PROMPT_CHARS,
            "max_history_messages": GENAI_MAX_HISTORY_MESSAGES,
            "seed": GENAI_DETERMINISTIC_SEED,
        },
        "models": {},
        "last_error": LAST_OLLAMA_ERROR,
    }

    for model_id, mod in MODELS.items():
        preferred = [OLLAMA_DEFAULT_MODEL]
        matched = [m for m in preferred if m in tag_set] if tags else []
        report["models"][model_id] = {
            "preferred": preferred,
            "matched": matched,
            "usable": report["ollama_reachable"] and bool(OLLAMA_DEFAULT_MODEL),
            "max_tokens": getattr(mod, "MAX_TOKENS", 0),
        }
    return report


def _normalize_messages(prompt, messages):
    normalized = []
    for item in messages or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant", "system"} or not content:
            continue
        normalized.append({
            "role": role,
            "content": content[:GENAI_MAX_PROMPT_CHARS],
        })

    normalized = normalized[-GENAI_MAX_HISTORY_MESSAGES:]
    if not normalized and prompt:
        normalized.append({"role": "user", "content": prompt[:GENAI_MAX_PROMPT_CHARS]})
    return normalized


def _query_ollama(prompt, model_module, messages=None, thinking_active=False):
    """
    Send a prompt to local Ollama using the selected model's settings.
    Returns (response_text, thinking_active).
    """
    global LAST_OLLAMA_ERROR
    client = _get_ollama_client()
    if client is None:
        LAST_OLLAMA_ERROR = "OLLAMA_BASE_URL is not configured"
        return None, False

    if hasattr(model_module, "get_system_prompt"):
        system, thinking_active = model_module.get_system_prompt(prompt)
    else:
        system = model_module.SYSTEM_PROMPT
        thinking_active = False
    override = _system_prompt_override_for_model(model_module.MODEL_ID)
    if override:
        system = override

    chat_messages = _normalize_messages(prompt, messages)
    if chat_messages and chat_messages[0]["role"] != "system":
        chat_messages = [{"role": "system", "content": system}] + chat_messages
    elif chat_messages:
        chat_messages[0]["content"] = system

    options = {
        "num_predict": model_module.MAX_TOKENS,
        "temperature": model_module.TEMPERATURE,
        "top_k": model_module.TOP_K,
        "top_p": model_module.TOP_P,
        "repeat_penalty": 1.1,
        "seed": GENAI_DETERMINISTIC_SEED,
    }
    options.update(getattr(model_module, "OLLAMA_OPTIONS", {}))

    try:
        stream = client.chat(
            model=OLLAMA_DEFAULT_MODEL,
            messages=chat_messages,
            stream=True,
            options=options,
        )
        parts = []
        for part in stream:
            if not isinstance(part, dict):
                continue
            message = part.get("message", {}) or {}
            content = message.get("content", "")
            if content:
                parts.append(content)
        text = "".join(parts).strip()
        if text:
            LAST_OLLAMA_ERROR = ""
            return text, thinking_active
        LAST_OLLAMA_ERROR = "Empty response from Ollama Cloud"
    except Exception as e:
        LAST_OLLAMA_ERROR = str(e)

    return None, False


def query(prompt, model_id=None, messages=None):
    """
    Main entry point.

    Args:
        prompt: User prompt string
        model_id: "g0.5-nano" | "g0.5-mini" | "g0.5"
    """
    if not prompt or not prompt.strip():
        return {
            "response": "Say something!",
            "intent": "empty",
            "engine": "rule",
            "model": model_id or DEFAULT_MODEL,
            "thinking": False,
        }

    prompt = prompt.strip()[:GENAI_MAX_PROMPT_CHARS]
    model_id = model_id if model_id in MODELS else DEFAULT_MODEL
    mod = MODELS[model_id]

    reply, thinking = _query_ollama(prompt, mod, messages=messages)
    if reply:
        return {
            "response": reply,
            "intent": "ollama",
            "engine": "ollama",
            "model": model_id,
            "thinking": thinking,
        }

    rule = mod.rule_response(prompt)
    return {
        **rule,
        "engine": "rule",
        "model": model_id,
        "thinking": False,
    }


if __name__ == "__main__":
    tests = [
        ("Hello!", "g0.5-nano"),
        ("What is 99 * 12?", "g0.5-nano"),
        ("Write me a short essay intro about AI.", "g0.5-mini"),
        ("Write a Python function to reverse a linked list.", "g0.5"),
        ("Explain the difference between TCP and UDP.", "g0.5"),
    ]
    print(f"\n{'=' * 55}")
    print("  GenAI Router v0.26.2.0 - Self Test")
    print(f"{'=' * 55}")
    for prompt, model in tests:
        result = query(prompt, model)
        think_tag = " [ThinkingMini V0.3]" if result.get("thinking") else ""
        print(f"\n[{result['model']}]{think_tag} > {prompt}")
        print(f"  [{result['engine']}] {result['response']}")
    print(f"\n{'=' * 55}")
