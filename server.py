"""
server.py - GenAI Web Server v0.26.2.0
Flask REST API. Routes to ai.py model router.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import ai
import os
import time

app = Flask(__name__)
CORS(app)
START_TIME = time.time()


@app.route("/", methods=["GET"])
def index():
    return jsonify({"status": "online", "name": "GenAI", "version": "0.26.2.0"})


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True)
    if not data or "prompt" not in data:
        return jsonify({"error": "Missing 'prompt'"}), 400
    prompt = str(data.get("prompt", ""))[:600]
    model_id = str(data.get("model", ai.DEFAULT_MODEL))
    result = ai.query(prompt, model_id)
    return jsonify(result)


@app.route("/status", methods=["GET"])
def status():
    uptime = round(time.time() - START_TIME, 1)
    ollama_up = ai.ollama_health_check(timeout=2)
    return jsonify({
        "status": "online",
        "version": "0.26.2.0",
        "uptime_seconds": uptime,
        "ollama": ollama_up,
        "ollama_configured": bool(ai.OLLAMA_BASE_URL),
        "ollama_base_url": ai.OLLAMA_BASE_URL,
        "default_model": ai.DEFAULT_MODEL,
        "models": list(ai.MODELS.keys()),
    })


@app.route("/health/models", methods=["GET"])
def health_models():
    return jsonify(ai.model_health_report())


if __name__ == "__main__":
    host = os.getenv("GENAI_HOST", "0.0.0.0")
    port = int(os.getenv("GENAI_PORT", "5000"))
    print("=" * 44)
    print(f"  GenAI v0.26.2.0 - http://{host}:{port}")
    print("=" * 44)
    app.run(host=host, port=port, debug=False)
