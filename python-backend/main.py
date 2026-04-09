import os
import sys
import uuid
import json as _json
import logging
import subprocess
import threading
import time
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

from config import AI_CONFIGS, FALLBACK_ORDER, get_active_model, set_active_model
from api_client import (
    session_exists, get_session_info, delete_session,
    send_prompt, check_ai_available,
    get_api_key, set_api_key, delete_api_key, get_key_info,
)
from history_manager import (
    add_message, get_messages, get_all_summaries, clear_messages, get_stats
)
from file_manager import (
    get_file_tree, read_file, write_file, create_file, delete_path,
    rename_path, get_language, LANGUAGE_MAP
)
from terminal_manager import exec_command, get_cwd, set_cwd, get_env_info
from agent import run_agent, get_status as get_agent_status, get_screenshot_path

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


# ─── AI Proxy ────────────────────────────────────────────────────────────────

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
            "models": config.get("models", []),
            "currentModel": get_active_model(ai_id),
        })
    return jsonify({"ais": ais})


@app.route("/api/proxy/set-model", methods=["POST"])
def set_model():
    data = request.get_json()
    ai_id = data.get("aiId")
    model_id = data.get("modelId")
    if not ai_id or not model_id:
        return jsonify({"error": "aiId and modelId are required"}), 400
    ok = set_active_model(ai_id, model_id)
    if not ok:
        return jsonify({"error": f"Invalid model '{model_id}' for AI '{ai_id}'"}), 400
    return jsonify({"success": True, "aiId": ai_id, "modelId": model_id})


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


@app.route("/api/proxy/ask-with-context", methods=["POST"])
def ask_ai_with_context():
    data = request.get_json()
    ai_id = data.get("aiId")
    user_prompt = data.get("prompt", "").strip()
    files = data.get("files", [])
    action = data.get("action")
    conversation_id = data.get("conversationId") or str(uuid.uuid4())
    use_fallback = data.get("fallback", True)

    if not ai_id or not user_prompt:
        return jsonify({"error": "aiId and prompt are required"}), 400

    ACTION_PREFIXES = {
        "fix": "Please analyze the following code and fix any bugs, errors, or issues. Explain what you changed and why.\n\n",
        "explain": "Please explain the following code in detail. Describe what it does, how it works, and any important patterns or concepts used.\n\n",
        "test": "Please write comprehensive unit tests for the following code. Use appropriate testing frameworks and cover edge cases.\n\n",
        "refactor": "Please refactor the following code to improve readability, performance, and maintainability. Follow best practices and explain your changes.\n\n",
        "suggest": "Please review the following code and suggest improvements, optimizations, and best practices.\n\n",
        "debug": "Please help debug the following code. Identify potential issues, explain the root cause, and provide a fix.\n\n",
        "document": "Please add comprehensive documentation, docstrings, and inline comments to the following code.\n\n",
    }

    prefix = ACTION_PREFIXES.get(action, "") if action else ""

    file_context = ""
    if files:
        file_context = "\n\n--- Attached Files ---\n"
        for f in files:
            lang = f.get("language") or get_language(f.get("path", ""))
            file_context += f"\n**File: `{f['path']}`**\n```{lang}\n{f['content']}\n```\n"

    full_prompt = prefix + user_prompt + file_context

    add_message(ai_id, "user", full_prompt, conversation_id)

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

        success, response_text, error = send_prompt(current_ai, full_prompt)
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

    elapsed_ms = int((time.time() - start_time) * 1000)
    return jsonify({
        "success": False,
        "aiId": ai_id,
        "response": "",
        "conversationId": conversation_id,
        "elapsedMs": elapsed_ms,
        "fallbackUsed": fallback_used,
        "error": f"All AIs failed. Tried: {tried_ais}",
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

    allowed_languages = {
        "python": ["python3", "-c"],
        "javascript": ["node", "-e"],
        "bash": ["bash", "-c"]
    }
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


# ─── API Key Management (replaces browser Sessions) ──────────────────────────

@app.route("/api/sessions")
def list_sessions():
    sessions = []
    for ai_id, config in AI_CONFIGS.items():
        info = get_key_info(ai_id)
        sessions.append({
            "aiId": ai_id,
            "aiName": config["name"],
            **info,
        })
    return jsonify({"sessions": sessions})


@app.route("/api/sessions/set-key", methods=["POST"])
def set_key_route():
    data = request.get_json()
    ai_id = data.get("aiId")
    api_key = (data.get("apiKey") or "").strip()

    if not ai_id:
        return jsonify({"success": False, "message": "aiId is required"}), 400
    if ai_id not in AI_CONFIGS:
        return jsonify({"success": False, "message": f"Unknown AI: {ai_id}"}), 400
    if not api_key:
        return jsonify({"success": False, "message": "apiKey is required"}), 400

    ok = set_api_key(ai_id, api_key)
    if ok:
        config = AI_CONFIGS[ai_id]
        logger.info("API key set for %s", ai_id)
        return jsonify({
            "success": True,
            "message": f"API key saved for {config['name']}",
            "aiId": ai_id,
        })
    return jsonify({"success": False, "message": "Failed to save key"}), 500


@app.route("/api/sessions/create", methods=["POST"])
def create_session():
    """
    Legacy endpoint kept for API-client-react compatibility.
    Expects {aiId, apiKey} — just calls set_key_route logic.
    """
    data = request.get_json()
    ai_id = data.get("aiId")
    api_key = (data.get("apiKey") or "").strip()

    if not ai_id:
        return jsonify({"success": False, "message": "aiId is required"}), 400
    if ai_id not in AI_CONFIGS:
        return jsonify({"success": False, "message": f"Unknown AI: {ai_id}"}), 400
    if not api_key:
        return jsonify({"success": False, "message": "apiKey is required — enter your API key"}), 400

    ok = set_api_key(ai_id, api_key)
    if ok:
        config = AI_CONFIGS[ai_id]
        return jsonify({
            "success": True,
            "message": f"API key saved for {config['name']}",
            "aiId": ai_id,
        })
    return jsonify({"success": False, "message": "Failed to save key"}), 500


@app.route("/api/sessions/<ai_id>/delete", methods=["DELETE"])
def delete_session_route(ai_id):
    success, message = delete_api_key(ai_id)
    return jsonify({"success": success, "message": message, "aiId": ai_id})


@app.route("/api/sessions/verify/<ai_id>", methods=["POST"])
def verify_key_route(ai_id):
    """Send a trivial test prompt to verify the key works."""
    if ai_id not in AI_CONFIGS:
        return jsonify({"success": False, "message": f"Unknown AI: {ai_id}"}), 400

    success, _text, error = send_prompt(ai_id, "Reply with exactly one word: OK")
    if success:
        return jsonify({"success": True, "message": "API key is working"})
    return jsonify({"success": False, "message": error or "Key verification failed"}), 400


# ─── History ─────────────────────────────────────────────────────────────────

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


# ─── File System ─────────────────────────────────────────────────────────────

@app.route("/api/files/tree")
def file_tree():
    path = request.args.get("path", ".")
    depth = int(request.args.get("depth", 3))
    depth = min(depth, 6)
    try:
        result = get_file_tree(path, depth)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/files/read")
def file_read():
    path = request.args.get("path")
    if not path:
        return jsonify({"error": "path is required"}), 400
    try:
        result = read_file(path)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/files/write", methods=["POST"])
def file_write():
    data = request.get_json()
    path = data.get("path")
    content = data.get("content", "")
    if not path:
        return jsonify({"error": "path is required"}), 400
    try:
        result = write_file(path, content)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/files/create", methods=["POST"])
def file_create():
    data = request.get_json()
    path = data.get("path")
    file_type = data.get("type", "file")
    content = data.get("content")
    if not path:
        return jsonify({"error": "path is required"}), 400
    try:
        result = create_file(path, file_type, content)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/files/delete", methods=["DELETE"])
def file_delete():
    path = request.args.get("path")
    if not path:
        return jsonify({"error": "path is required"}), 400
    try:
        result = delete_path(path)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/files/rename", methods=["POST"])
def file_rename():
    data = request.get_json()
    old_path = data.get("oldPath")
    new_path = data.get("newPath")
    if not old_path or not new_path:
        return jsonify({"error": "oldPath and newPath are required"}), 400
    try:
        result = rename_path(old_path, new_path)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ─── Terminal ─────────────────────────────────────────────────────────────────

@app.route("/api/terminal/exec", methods=["POST"])
def terminal_exec():
    data = request.get_json()
    command = data.get("command", "").strip()
    if not command:
        return jsonify({"error": "command is required"}), 400
    cwd = data.get("cwd")
    timeout = min(int(data.get("timeout", 60)), 300)
    try:
        result = exec_command(command, cwd=cwd, timeout=timeout)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/terminal/cwd", methods=["GET"])
def terminal_cwd():
    try:
        info = get_env_info()
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Agent ───────────────────────────────────────────────────────────────────

@app.route("/api/agent/run", methods=["POST"])
def agent_run():
    data = request.get_json()
    ai_id = data.get("aiId")
    task = data.get("task", "").strip()
    if not ai_id or not task:
        return jsonify({"error": "aiId and task are required"}), 400

    working_dir = data.get("workingDir")
    max_steps = min(int(data.get("maxSteps", 20)), 30)

    current = get_agent_status()
    if current.get("running"):
        return jsonify({"error": "An agent task is already running"}), 409

    def _run():
        try:
            run_agent(ai_id, task, working_dir=working_dir, max_steps=max_steps)
        except Exception as e:
            logger.error(f"Agent thread error: {e}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return jsonify({"running": True, "task": task, "steps": [], "result": None})


@app.route("/api/agent/status", methods=["GET"])
def agent_status():
    try:
        status = get_agent_status()
        return jsonify(status)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/agent/screenshot/<filename>", methods=["GET"])
def agent_screenshot(filename: str):
    if not filename.endswith(".png") or "/" in filename or ".." in filename:
        return jsonify({"error": "invalid filename"}), 400
    path = get_screenshot_path(filename)
    if not path:
        return jsonify({"error": "screenshot not found"}), 404
    return send_file(str(path), mimetype="image/png")


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_BACKEND_PORT", 5050))
    logger.info(f"Starting Universal AI Coding Proxy backend on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
