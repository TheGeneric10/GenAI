"""
server.py — GenAI Web Server  v0.26.2.0
Flask REST API. Routes to ai.py model router.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import ai
import time
import urllib.request

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
    prompt   = str(data.get("prompt", ""))[:600]
    model_id = str(data.get("model", ai.DEFAULT_MODEL))
    result   = ai.query(prompt, model_id)
    return jsonify(result)


@app.route("/status", methods=["GET"])
def status():
    uptime = round(time.time() - START_TIME, 1)
    ollama_up = False
    try:
        req = urllib.request.Request("http://127.0.0.1:11434", method="GET")
        with urllib.request.urlopen(req, timeout=2):
            ollama_up = True
    except Exception:
        pass
    return jsonify({
        "status":          "online",
        "version":         "0.26.2.0",
        "uptime_seconds":  uptime,
        "ollama":          ollama_up,
        "default_model":   ai.DEFAULT_MODEL,
        "models":          list(ai.MODELS.keys()),
    })


if __name__ == "__main__":
    print("=" * 44)
    print("  GenAI v0.26.2.0  — http://127.0.0.1:5000")
    print("=" * 44)
    app.run(host="127.0.0.1", port=5000, debug=False)