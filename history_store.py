"""Server-side chat history per profile (manual Send + cron use the same store)."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path


_lock = threading.Lock()


def _data_dir() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    base = Path(raw).expanduser().resolve() if raw else Path.home() / ".hermes"
    d = base / "webui-minimal"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path() -> Path:
    return _data_dir() / "chat_history.json"


def _load_raw() -> dict:
    p = _path()
    if not p.is_file():
        return {"rev": 0, "by_profile": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"rev": 0, "by_profile": {}}
        data.setdefault("rev", 0)
        data.setdefault("by_profile", {})
        return data
    except (json.JSONDecodeError, OSError):
        return {"rev": 0, "by_profile": {}}


def _save_raw(data: dict) -> None:
    p = _path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def get_state() -> dict:
    with _lock:
        return json.loads(json.dumps(_load_raw()))


def get_profile_messages(profile: str) -> tuple[list[dict], int]:
    with _lock:
        data = _load_raw()
        bucket = data["by_profile"].get(profile) or {"messages": []}
        msgs = bucket.get("messages") if isinstance(bucket, dict) else []
        if not isinstance(msgs, list):
            msgs = []
        return msgs, int(data.get("rev") or 0)


def append_exchange(profile: str, user_text: str, assistant_text: str, tag: str | None = None) -> tuple[list[dict], int]:
    """Append user + assistant. Optional tag prefix on user line (e.g. cron job name)."""
    with _lock:
        data = _load_raw()
        data["rev"] = int(data.get("rev") or 0) + 1
        byp = data["by_profile"]
        if profile not in byp or not isinstance(byp[profile], dict):
            byp[profile] = {"messages": []}
        messages: list = byp[profile]["messages"]
        u = user_text.strip()
        if tag:
            u = f"[{tag}]\n{u}"
        messages.append({"role": "user", "text": u, "ts": time.time()})
        messages.append({"role": "assistant", "text": assistant_text, "ts": time.time()})
        _save_raw(data)
        return list(messages), data["rev"]
