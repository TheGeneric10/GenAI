"""
ai.py - GenAI Core Router v0.26.2.0
Routes prompts to the selected model and queries Ollama first.
Falls back to lightweight rule handlers if Ollama is unavailable.
"""

import json
import os
import sys
import urllib.request


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "models"))

import g05 as pro
import g05_mini as mini
import g05_nano as nano


def _normalize_ollama_base_url(raw_url):
    base = (raw_url or "http://127.0.0.1:11434").strip().rstrip("/")
    if not base:
        return "http://127.0.0.1:11434"
    if "/api/" in base:
        return base.split("/api/", 1)[0]
    return base


OLLAMA_BASE_URL = _normalize_ollama_base_url(os.getenv("OLLAMA_BASE_URL"))
OLLAMA_URL = f"{OLLAMA_BASE_URL}/api/generate"
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "").strip()
OLLAMA_AUTH_SCHEME = os.getenv("OLLAMA_AUTH_SCHEME", "Bearer").strip()
OLLAMA_KEY_HEADER = os.getenv("OLLAMA_KEY_HEADER", "Authorization").strip()

MODELS = {
    "g0.5-nano": nano,
    "g0.5-mini": mini,
    "g0.5": pro,
}

DEFAULT_MODEL = "g0.5-mini"


def _build_ollama_headers():
    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        if OLLAMA_KEY_HEADER.lower() == "authorization":
            headers["Authorization"] = f"{OLLAMA_AUTH_SCHEME} {OLLAMA_API_KEY}".strip()
        else:
            headers[OLLAMA_KEY_HEADER] = OLLAMA_API_KEY
    return headers


def ollama_health_check(timeout=2):
    status_url = f"{OLLAMA_BASE_URL}/"
    req = urllib.request.Request(status_url, headers=_build_ollama_headers(), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except Exception:
        return False


def _query_ollama(prompt, model_module, thinking_active=False):
    """
    Send a prompt to local Ollama using the selected model's settings.
    Returns (response_text, thinking_active).
    """
    if hasattr(model_module, "get_system_prompt"):
        system, thinking_active = model_module.get_system_prompt(prompt)
    else:
        system = model_module.SYSTEM_PROMPT
        thinking_active = False

    model_names = getattr(model_module, "OLLAMA_MODELS", [model_module.OLLAMA_MODEL])
    options = {
        "num_predict": model_module.MAX_TOKENS,
        "temperature": model_module.TEMPERATURE,
        "top_k": model_module.TOP_K,
        "top_p": model_module.TOP_P,
        "repeat_penalty": 1.1,
    }
    options.update(getattr(model_module, "OLLAMA_OPTIONS", {}))
    timeout = 20 if model_module.MODEL_ID == "g0.5" else 12

    for model_name in model_names:
        payload = json.dumps({
            "model": model_name,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": options,
        }).encode("utf-8")

        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers=_build_ollama_headers(),
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = data.get("response", "").strip()
                return text, thinking_active
        except Exception:
            continue

    return None, False


def query(prompt, model_id=None):
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

    prompt = prompt.strip()[:600]
    model_id = model_id if model_id in MODELS else DEFAULT_MODEL
    mod = MODELS[model_id]

    reply, thinking = _query_ollama(prompt, mod)
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
