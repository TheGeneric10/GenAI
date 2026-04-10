"""
ai.py - GenAI Core Router v0.26.2.0
Routes prompts to Fireworks Cloud first.
Falls back to lightweight rule handlers if cloud is unavailable.
"""

import json
import os
import sys
import urllib.error
import urllib.request


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "models"))

import g05 as pro
import g05_mini as mini
import g05_nano as nano


def _normalize_base_url(raw_url):
    base = (raw_url or "").strip().rstrip("/")
    return base or "https://api.fireworks.ai/inference/v1"


FIREWORKS_BASE_URL = _normalize_base_url(os.getenv("FIREWORKS_BASE_URL"))
FIREWORKS_API_KEY = os.getenv("FIREWORKS_API_KEY", "").strip()
FIREWORKS_MODEL = os.getenv(
    "FIREWORKS_MODEL",
    "accounts/fireworks/models/llama-v3p1-8b-instruct",
).strip() or "accounts/fireworks/models/llama-v3p1-8b-instruct"
GENAI_MAX_PROMPT_CHARS = int(os.getenv("GENAI_MAX_PROMPT_CHARS", "2000"))
GENAI_MAX_HISTORY_MESSAGES = int(os.getenv("GENAI_MAX_HISTORY_MESSAGES", "12"))
GENAI_DETERMINISTIC_SEED = int(os.getenv("GENAI_DETERMINISTIC_SEED", "42"))
LAST_PROVIDER_ERROR = ""

MODELS = {
    "g0.5-nano": nano,
    "g0.5-mini": mini,
    "g0.5": pro,
}

DEFAULT_MODEL = "g0.5-mini"


def _system_prompt_override_for_model(model_id):
    env_key = "GENAI_PROMPT_" + model_id.replace(".", "").replace("-", "_").upper()
    return os.getenv(env_key, "").strip()


def _build_headers():
    headers = {"Content-Type": "application/json"}
    if FIREWORKS_API_KEY:
        headers["Authorization"] = f"Bearer {FIREWORKS_API_KEY}"
    return headers


def _api_request(path, payload=None, timeout=8):
    url = f"{FIREWORKS_BASE_URL}{path}"
    data = None
    method = "GET"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        method = "POST"
    req = urllib.request.Request(url, data=data, headers=_build_headers(), method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ollama_health_check(timeout=2):
    if not FIREWORKS_API_KEY:
        return False
    try:
        _api_request("/models", timeout=timeout)
        return True
    except Exception:
        return False


def _fetch_model_tags(timeout=6):
    if not FIREWORKS_API_KEY:
        return []
    try:
        data = _api_request("/models", timeout=timeout)
        models = data.get("data", []) if isinstance(data, dict) else []
        return [m.get("id", "") for m in models if isinstance(m, dict) and m.get("id")]
    except Exception:
        return []


def model_health_report():
    tags = _fetch_model_tags()
    tag_set = set(tags)
    report = {
        "provider": "fireworks",
        "fireworks_base_url": FIREWORKS_BASE_URL,
        "fireworks_model": FIREWORKS_MODEL,
        "fireworks_configured": bool(FIREWORKS_API_KEY),
        "fireworks_reachable": ollama_health_check(timeout=2),
        "available_models": tags,
        "limits": {
            "max_prompt_chars": GENAI_MAX_PROMPT_CHARS,
            "max_history_messages": GENAI_MAX_HISTORY_MESSAGES,
            "seed": GENAI_DETERMINISTIC_SEED,
        },
        "models": {},
        "last_error": LAST_PROVIDER_ERROR,
    }

    for model_id, mod in MODELS.items():
        preferred = [FIREWORKS_MODEL]
        matched = [m for m in preferred if m in tag_set] if tags else []
        report["models"][model_id] = {
            "preferred": preferred,
            "matched": matched,
            "usable": report["fireworks_reachable"] and bool(FIREWORKS_MODEL),
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


def _query_cloud(prompt, model_module, messages=None, thinking_active=False):
    global LAST_PROVIDER_ERROR
    if not FIREWORKS_API_KEY:
        LAST_PROVIDER_ERROR = "FIREWORKS_API_KEY is not configured"
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

    payload = {
        "model": FIREWORKS_MODEL,
        "messages": chat_messages,
        "max_tokens": model_module.MAX_TOKENS,
        "temperature": model_module.TEMPERATURE,
        "top_p": model_module.TOP_P,
        "stream": False,
        "seed": GENAI_DETERMINISTIC_SEED,
    }

    try:
        data = _api_request("/chat/completions", payload=payload, timeout=30)
        choices = data.get("choices", []) if isinstance(data, dict) else []
        if choices:
            message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
            text = str(message.get("content", "")).strip()
            if text:
                LAST_PROVIDER_ERROR = ""
                return text, thinking_active
        LAST_PROVIDER_ERROR = "Empty response from Fireworks"
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        LAST_PROVIDER_ERROR = f"{e.code} {body[:180]}".strip()
    except Exception as e:
        LAST_PROVIDER_ERROR = str(e)

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

    reply, thinking = _query_cloud(prompt, mod, messages=messages)
    if reply:
        return {
            "response": reply,
            "intent": "cloud",
            "engine": "cloud",
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

