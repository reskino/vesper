import os
import sys
import uuid
import logging
import subprocess
import threading
import time
from flask import Flask, jsonify, request
from flask_cors import CORS

from config import AI_CONFIGS, FALLBACK_ORDER
from playwright_utils import (
    session_exists, get_session_info, create_session_interactive,
    delete_session, send_prompt, check_ai_available
)
from history_manager import (
    add_message, get_messages, get_all_summaries, clear_messages, get_stats
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.route("/api/healthz")
def health_check():
    return jsonify({"status": "ok"})


@app.route("/api/proxy/ais")
def list_ais():
    ais = []
    for ai_id, config in AI_CONFIGS.items():
        ais.append({
            "id": ai_id,
            "name": config["name"],
            "url": config["url"],
            "hasSession": session_exists(ai_id),
            "isAvailable": True,
            "icon": config.get("icon"),
        })
    return jsonify({"ais": ais})


@app.route("/api/proxy/ask", methods=["POST"])
def ask_ai():
    data = request.get_json()
    ai_id = data.get("aiId")
    prompt = data.get("prompt", "").strip()
    conversation_id = data.get("conversationId") or str(uuid.uuid4())
    use_fallback = data.get("fallback", True)

    if not ai_id or not prompt:
        return jsonify({"error": "aiId and prompt are required"}), 400

    add_message(ai_id, "user", prompt, conversation_id)

    start_time = time.time()
    fallback_used = False
    tried_ais = []

    ais_to_try = [ai_id]
    if use_fallback:
        for fallback_ai in FALLBACK_ORDER:
            if fallback_ai != ai_id and fallback_ai not in ais_to_try:
                ais_to_try.append(fallback_ai)

    for current_ai in ais_to_try:
        if not session_exists(current_ai):
            tried_ais.append(current_ai)
            continue

        if current_ai != ai_id:
            fallback_used = True
            logger.info(f"Falling back to {current_ai} (tried: {tried_ais})")

        success, response_text, error = send_prompt(current_ai, prompt)
        elapsed_ms = int((time.time() - start_time) * 1000)

        if success and response_text:
            add_message(ai_id, "assistant", response_text, conversation_id)
            return jsonify({
                "success": True,
                "aiId": current_ai,
                "response": response_text,
                "conversationId": conversation_id,
                "elapsedMs": elapsed_ms,
                "fallbackUsed": fallback_used,
                "error": None,
            })

        tried_ais.append(current_ai)
        logger.warning(f"AI {current_ai} failed: {error}")

    elapsed_ms = int((time.time() - start_time) * 1000)
    error_msg = f"All AIs failed. Tried: {tried_ais}"
    return jsonify({
        "success": False,
        "aiId": ai_id,
        "response": "",
        "conversationId": conversation_id,
        "elapsedMs": elapsed_ms,
        "fallbackUsed": fallback_used,
        "error": error_msg,
    }), 503


@app.route("/api/proxy/execute", methods=["POST"])
def execute_code():
    data = request.get_json()
    code = data.get("code", "").strip()
    language = data.get("language", "python")
    timeout = min(int(data.get("timeout", 30)), 60)

    if not code:
        return jsonify({"error": "code is required"}), 400

    start_time = time.time()

    allowed_languages = {"python": ["python3", "-c"], "javascript": ["node", "-e"], "bash": ["bash", "-c"]}
    if language not in allowed_languages:
        return jsonify({"error": f"Unsupported language: {language}"}), 400

    cmd = allowed_languages[language] + [code]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd="/tmp",
        )
        elapsed_ms = int((time.time() - start_time) * 1000)
        return jsonify({
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exitCode": result.returncode,
            "elapsedMs": elapsed_ms,
        })
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.time() - start_time) * 1000)
        return jsonify({
            "success": False,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout}s",
            "exitCode": 1,
            "elapsedMs": elapsed_ms,
        })
    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        return jsonify({
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "exitCode": 1,
            "elapsedMs": elapsed_ms,
        })


@app.route("/api/sessions")
def list_sessions():
    sessions = []
    for ai_id, config in AI_CONFIGS.items():
        info = get_session_info(ai_id)
        sessions.append({
            "aiId": ai_id,
            "aiName": config["name"],
            **info,
        })
    return jsonify({"sessions": sessions})


@app.route("/api/sessions/create", methods=["POST"])
def create_session():
    data = request.get_json()
    ai_id = data.get("aiId")

    if not ai_id:
        return jsonify({"success": False, "message": "aiId is required"}), 400

    if ai_id not in AI_CONFIGS:
        return jsonify({"success": False, "message": f"Unknown AI: {ai_id}"}), 400

    def run_session():
        create_session_interactive(ai_id)

    thread = threading.Thread(target=run_session, daemon=True)
    thread.start()

    return jsonify({
        "success": True,
        "message": f"Browser opened for {AI_CONFIGS[ai_id]['name']}. Please log in, then close the browser window to save your session.",
        "aiId": ai_id,
    })


@app.route("/api/sessions/<ai_id>/delete", methods=["DELETE"])
def delete_session_route(ai_id):
    success, message = delete_session(ai_id)
    return jsonify({"success": success, "message": message, "aiId": ai_id})


@app.route("/api/history")
def list_history():
    summaries = get_all_summaries(AI_CONFIGS)
    return jsonify({"conversations": summaries})


@app.route("/api/history/stats")
def history_stats():
    stats = get_stats(AI_CONFIGS)
    return jsonify(stats)


@app.route("/api/history/<ai_id>")
def get_history(ai_id):
    messages = get_messages(ai_id)
    return jsonify({"aiId": ai_id, "messages": messages})


@app.route("/api/history/<ai_id>", methods=["DELETE"])
def clear_history_route(ai_id):
    clear_messages(ai_id)
    return jsonify({"success": True, "message": f"History cleared for {ai_id}", "aiId": ai_id})


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_BACKEND_PORT", 5050))
    logger.info(f"Starting Universal AI Coding Proxy backend on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
