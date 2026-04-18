"""Run Hermes CLI chat (same path as manual Send). Used by HTTP API and cron."""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

_PROFILE_RE = re.compile(r"^[a-zA-Z0-9_.-]+$")
_PROFILE_UPLOAD_SUBDIR = "uploads"
_MAX_PROFILE_UPLOAD_BYTES = 20 * 1024 * 1024
_RESUME_ID_RE = re.compile(r"^[a-zA-Z0-9_.:-]+$")
# Hermes session IDs look like 20250305_091523_a1b2c3d4 (see hermes-agent sessions docs).
_SESSION_ID_IN_LINE_RE = re.compile(r"\b(\d{8}_\d{6}_[a-fA-F0-9]+)\b")

_CLI_FOOTER_PREFIXES = (
    "session_id:",
    "Resume this session",
    "Session:",
    "Duration:",
    "Messages:",
)


def clean_hermes_cli_stdout(text: str) -> str:
    if not text or not text.strip():
        return text or ""
    raw = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = raw.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines:
        top = lines[0]
        if "╭" in top or ("Hermes" in top and "─" in top):
            lines.pop(0)
    while lines and not lines[0].strip():
        lines.pop(0)
    out: list[str] = []
    for line in lines:
        st = line.strip()
        if any(st.startswith(p) for p in _CLI_FOOTER_PREFIXES):
            break
        if st.startswith("╰"):
            continue
        out.append(line)
    result = "\n".join(out).rstrip()
    return result if result.strip() else raw.strip()


def _hermes_home() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return Path.home() / ".hermes"


def _hermes_agent_dir() -> Path:
    raw = os.environ.get("HERMES_AGENT_DIR", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _hermes_home() / "hermes-agent"


def _hermes_venv_python() -> Path | None:
    py = _hermes_agent_dir() / "venv" / "bin" / "python"
    if py.is_file():
        return py
    py3 = _hermes_agent_dir() / "venv" / "bin" / "python3"
    if py3.is_file():
        return py3
    return None


def _hermes_launcher_argv() -> list[str]:
    use_script = os.environ.get("HERMES_USE_SCRIPT", "").lower() in ("1", "true", "yes")
    explicit = os.environ.get("HERMES_BIN", "").strip()

    if explicit:
        base = Path(explicit).name
        if base in ("python", "python3") or base.startswith("python3."):
            return [explicit, "-m", "hermes_cli.main"]

    if not use_script:
        venv_py = _hermes_venv_python()
        if venv_py is not None:
            return [str(venv_py), "-m", "hermes_cli.main"]

    if explicit:
        return [explicit]
    w = shutil.which("hermes")
    return [w or "hermes"]


def resolve_profile_for_preview(want: str, profs: list[str]) -> tuple[str, str | None]:
    """
    Pick a profile for /api/cli-preview. Never raises: stale UI or casing mismatches
    should not break the composer hint.
    """
    if not profs:
        return "<profile>", "no profiles in Hermes home"
    if not want:
        return profs[0], None
    if want in profs:
        return want, None
    if sys.platform == "win32":
        wl = want.lower()
        for p in profs:
            if p.lower() == wl:
                return p, None
    return profs[0], f"profile {want!r} not on disk; showing {profs[0]!r}"


def list_profile_names() -> list[str]:
    root = _hermes_home()
    profiles_dir = root / "profiles"
    if not profiles_dir.is_dir():
        return []
    names: list[str] = []
    for p in profiles_dir.iterdir():
        if p.is_dir() and not p.name.startswith("."):
            names.append(p.name)
    return sorted(names, key=str.lower)


def validate_profile_name(name: str) -> tuple[bool, str]:
    if not name or not _PROFILE_RE.match(name):
        return False, "invalid profile name"
    if name not in list_profile_names():
        return False, f"unknown profile: {name}"
    return True, ""


def validate_resume_session_id(rid: str) -> tuple[bool, str]:
    s = (rid or "").strip()
    if not s:
        return True, ""
    if len(s) > 256:
        return False, "resume_session_id too long"
    if not _RESUME_ID_RE.match(s):
        return False, "invalid resume_session_id"
    return True, ""


def get_launcher_argv() -> list[str]:
    return _hermes_launcher_argv()


def get_hermes_home() -> Path:
    return _hermes_home()


def get_agent_dir() -> Path:
    return _hermes_agent_dir()


def config_path() -> Path:
    return Path(__file__).resolve().parent / "config.toml"


_toml_cache: dict | None = None


def invalidate_config_cache() -> None:
    """Clear cached config.toml (call after editing UI server config on disk)."""
    global _toml_cache
    _toml_cache = None


def _merged_config() -> dict:
    global _toml_cache
    if _toml_cache is not None:
        return _toml_cache
    path = config_path()
    if path.is_file():
        with path.open("rb") as f:
            _toml_cache = tomllib.load(f)
    else:
        _toml_cache = {}
    return _toml_cache


def _hermes_config_table() -> dict:
    t = _merged_config().get("hermes")
    return t if isinstance(t, dict) else {}


def _effective_extra_args_str() -> str:
    e = os.environ.get("HERMES_CHAT_EXTRA_ARGS")
    if e is not None and e.strip() != "":
        return e.strip()
    return str(_hermes_config_table().get("extra_args", "") or "").strip()


def _effective_use_quiet() -> bool:
    if "HERMES_CHAT_NO_QUIET" in os.environ:
        return os.environ["HERMES_CHAT_NO_QUIET"].strip().lower() not in ("1", "true", "yes")
    return bool(_hermes_config_table().get("use_quiet", True))


def _effective_strip_cli_output() -> bool:
    if "HERMES_UI_RAW_OUTPUT" in os.environ:
        return os.environ["HERMES_UI_RAW_OUTPUT"].strip().lower() not in ("1", "true", "yes")
    return bool(_hermes_config_table().get("strip_cli_output", True))


def _effective_timeout_sec() -> int:
    if "HERMES_CHAT_TIMEOUT_SEC" in os.environ:
        try:
            return int(os.environ["HERMES_CHAT_TIMEOUT_SEC"])
        except ValueError:
            pass
    v = _hermes_config_table().get("timeout_sec", 600)
    try:
        return int(v)
    except (TypeError, ValueError):
        return 600


def get_effective_chat_settings() -> dict:
    extra = _effective_extra_args_str()
    extra_parts = shlex.split(extra) if extra else []
    adds_quiet = _effective_use_quiet() and "-Q" not in extra_parts and "--quiet" not in extra_parts
    return {
        "config_file": str(config_path()) if config_path().is_file() else "",
        "adds_quiet_flag": adds_quiet,
        "strips_cli_banner": _effective_strip_cli_output(),
        "timeout_sec": _effective_timeout_sec(),
        "extra_args": _effective_extra_args_str(),
    }


def get_ui_text() -> dict:
    raw = _merged_config().get("ui")
    u = raw if isinstance(raw, dict) else {}
    return {
        "cli_caption": str(u.get("cli_caption", "CLI")),
        "cli_hint": str(
            u.get(
                "cli_hint",
                "Tune in config.toml or HERMES_* env vars; restart after editing the file.",
            )
        ),
    }


def get_profile_file_names() -> list[str]:
    """Basenames under HERMES_HOME/profiles/<profile>/ from config (see config.toml profile_files)."""
    cfg = _merged_config()
    raw = cfg.get("profile_files")
    if raw is None:
        raw = _hermes_config_table().get("profile_files")
    names: list[str] | None = None
    if isinstance(raw, list):
        names = [str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw, dict):
        f = raw.get("files")
        if isinstance(f, list):
            names = [str(x).strip() for x in f if str(x).strip()]
    if not names:
        names = ["SOUL.md", "config.yaml"]
    out: list[str] = []
    for n in names:
        if _PROFILE_RE.match(n):
            out.append(n)
    return out if out else ["SOUL.md", "config.yaml"]


def _default_profile_templates() -> dict[str, str]:
    """Fallback file bodies when [profile_templates] omits a key."""
    return {
        "SOUL.md": "# Agent profile (SOUL)\n\nDescribe this agent's role, tone, and constraints.\n",
        "config.yaml": (
            "# Hermes profile configuration\n"
            "# Add keys your Hermes build expects (model, toolsets, etc.).\n"
            "model: anthropic/claude-sonnet-4\n"
        ),
        ".env": (
            "# Optional: API keys and env vars for this profile only.\n"
            "# Example: OPENROUTER_API_KEY=\n"
        ),
    }


def get_profile_templates() -> dict[str, str]:
    """
    Map profile_files basename -> initial file body for new profiles.
    Reads [profile_templates] from config.toml; missing keys use _default_profile_templates().
    """
    cfg = _merged_config()
    raw = cfg.get("profile_templates")
    from_file: dict[str, str] = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k).strip()
            if key and isinstance(v, str):
                from_file[key] = v
    defaults = _default_profile_templates()
    out: dict[str, str] = {}
    for fname in get_profile_file_names():
        if fname in from_file and from_file[fname].strip():
            out[fname] = from_file[fname]
        else:
            out[fname] = defaults.get(fname, "")
    return out


def validate_new_profile_name(name: str) -> tuple[bool, str]:
    """True if name is safe and not an existing profile directory."""
    s = (name or "").strip()
    if not s or not _PROFILE_RE.match(s):
        return False, "invalid profile name"
    if s in list_profile_names():
        return False, f"profile already exists: {s}"
    prof_dir = (_hermes_home() / "profiles" / s).resolve()
    profiles_root = (_hermes_home() / "profiles").resolve()
    try:
        prof_dir.relative_to(profiles_root)
    except ValueError:
        return False, "invalid profile path"
    if prof_dir.exists():
        return False, "profile path already exists"
    return True, ""


def create_profile_with_templates(name: str) -> dict[str, Any]:
    """
    Create HERMES_HOME/profiles/<name>/ and write each profile_files entry from templates.
    Rolls back (removes directory) if any write fails.
    """
    ok, err = validate_new_profile_name(name)
    if not ok:
        return {"ok": False, "error": err}
    profiles_root = (_hermes_home() / "profiles").resolve()
    profiles_root.mkdir(parents=True, exist_ok=True)
    prof_dir = (profiles_root / name.strip()).resolve()
    try:
        prof_dir.relative_to(profiles_root)
    except ValueError:
        return {"ok": False, "error": "invalid profile path"}
    try:
        prof_dir.mkdir(parents=False)
    except FileExistsError:
        return {"ok": False, "error": "profile already exists"}
    except OSError as e:
        return {"ok": False, "error": str(e)}
    templates = get_profile_templates()
    files = get_profile_file_names()
    created: list[str] = []
    try:
        for fname in files:
            text = templates.get(fname, "")
            if not isinstance(text, str):
                text = ""
            target = (prof_dir / fname).resolve()
            try:
                target.relative_to(prof_dir)
            except ValueError:
                raise ValueError(f"invalid file name: {fname}") from None
            target.write_text(text, encoding="utf-8")
            created.append(fname)
    except Exception as e:
        shutil.rmtree(prof_dir, ignore_errors=True)
        return {"ok": False, "error": str(e)}
    return {"ok": True, "profile": name.strip(), "files": created}


def skill_segment_ok(segment: str) -> bool:
    """True if name is safe for one path segment (category or skill folder under skills/)."""
    s = (segment or "").strip()
    return bool(s and _PROFILE_RE.match(s))


def list_skill_categories_for_profile(profile: str) -> list[str]:
    """Basenames of category directories under profiles/<profile>/skills/."""
    ok, _ = validate_profile_name(profile)
    if not ok:
        return []
    root = _hermes_home() / "profiles" / profile / "skills"
    if not root.is_dir():
        return []
    categories: list[str] = []
    for p in root.iterdir():
        if p.is_dir() and not p.name.startswith(".") and _PROFILE_RE.match(p.name):
            categories.append(p.name)
    return sorted(categories, key=str.lower)


def list_skills_in_category_for_profile(profile: str, category: str) -> list[str]:
    """Basenames of skill directories under profiles/<profile>/skills/<category>/."""
    return skills_panel_for_profile_category(profile, category)["skills"]


def _dir_has_skill_leaf_markers(skill_dir: Path) -> bool:
    """True if folder looks like a single skill root (SKILL.md or at least one file), no nested skill dirs."""
    if not skill_dir.is_dir():
        return False
    for name in ("SKILL.md", "skill.md", "Skill.md"):
        if (skill_dir / name).is_file():
            return True
    for p in skill_dir.iterdir():
        if p.is_file():
            return True
    return False


def skills_panel_for_profile_category(profile: str, category: str) -> dict:
    """
    Skills under profiles/<profile>/skills/<category>/.

    If there are valid subdirectories, they are nested skills (category/skill in the UI).
    If there are none but the folder has SKILL.md or other files, it is a leaf skill: use skill: <category> only.
    """
    ok, _ = validate_profile_name(profile)
    if not ok or not skill_segment_ok(category):
        return {"skills": [], "leaf_skill": False}
    cat_dir = _hermes_home() / "profiles" / profile / "skills" / category.strip()
    if not cat_dir.is_dir():
        return {"skills": [], "leaf_skill": False}
    skills: list[str] = []
    for p in cat_dir.iterdir():
        if p.is_dir() and not p.name.startswith(".") and _PROFILE_RE.match(p.name):
            skills.append(p.name)
    skills.sort(key=str.lower)
    if skills:
        return {"skills": skills, "leaf_skill": False}
    if _dir_has_skill_leaf_markers(cat_dir):
        return {"skills": [], "leaf_skill": True}
    return {"skills": [], "leaf_skill": False}


def profile_data_file_path(profile: str, filename: str) -> Path:
    ok, err = validate_profile_name(profile)
    if not ok:
        raise ValueError(err)
    name = filename.strip()
    if not name or not _PROFILE_RE.match(name):
        raise ValueError("invalid file name")
    prof_dir = (_hermes_home() / "profiles" / profile).resolve()
    if not prof_dir.is_dir():
        raise ValueError("profile directory missing")
    target = (prof_dir / name).resolve()
    try:
        target.relative_to(prof_dir)
    except ValueError:
        raise ValueError("invalid file path") from None
    return target


def read_profile_sidecar_file(profile: str, filename: str) -> tuple[str, bool]:
    path = profile_data_file_path(profile, filename)
    if not path.is_file():
        return "", False
    return path.read_text(encoding="utf-8"), True


def write_profile_sidecar_file(profile: str, filename: str, content: str) -> None:
    path = profile_data_file_path(profile, filename)
    path.write_text(content, encoding="utf-8")


def profile_uploads_base_dir(profile: str) -> Path:
    ok, err = validate_profile_name(profile)
    if not ok:
        raise ValueError(err)
    prof_dir = (_hermes_home() / "profiles" / profile).resolve()
    if not prof_dir.is_dir():
        raise ValueError("profile directory missing")
    uploads = (prof_dir / _PROFILE_UPLOAD_SUBDIR).resolve()
    try:
        uploads.relative_to(prof_dir)
    except ValueError:
        raise ValueError("invalid uploads path") from None
    return uploads


def sanitize_upload_basename(filename: str) -> str:
    raw = (filename or "").strip()
    base = Path(raw).name
    base = re.sub(r"[^\w.\-]", "_", base)[:200]
    if not base or base.strip(".") == "":
        raise ValueError("invalid filename")
    return base


def save_profile_upload(profile: str, filename: str, data: bytes) -> Path:
    if len(data) > _MAX_PROFILE_UPLOAD_BYTES:
        raise ValueError(f"file too large (max {_MAX_PROFILE_UPLOAD_BYTES // (1024 * 1024)}MB)")
    dest_dir = profile_uploads_base_dir(profile)
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = sanitize_upload_basename(filename)
    dest = (dest_dir / safe).resolve()
    try:
        dest.relative_to(dest_dir)
    except ValueError:
        raise ValueError("invalid destination path") from None
    dest.write_bytes(data)
    return dest


def build_chat_argv(profile: str, message: str, resume_session_id: str | None = None) -> list[str]:
    """Hermes argv for one chat turn (no validation of profile name)."""
    extra = _effective_extra_args_str()
    extra_parts = shlex.split(extra) if extra else []
    add_quiet = _effective_use_quiet() and "-Q" not in extra_parts and "--quiet" not in extra_parts
    cmd: list[str] = _hermes_launcher_argv() + ["--profile", profile, "chat"]
    if add_quiet:
        cmd.append("-Q")
    cmd.extend(["-q", message])
    rs = (resume_session_id or "").strip()
    if rs:
        cmd.extend(["--resume", rs])
    cmd.extend(extra_parts)
    return cmd


def chat_command_display(argv: list[str]) -> str:
    """Shell-style line for the UI; same argv as the real run, but venv python path shown as python."""
    if not argv:
        return shlex.join(argv)
    parts = list(argv)
    if len(parts) >= 3 and parts[1] == "-m" and str(parts[2]).endswith("hermes_cli.main"):
        parts[0] = "python"
    return shlex.join(parts)


def _run_hermes_argv(
    cmd: list[str], *, timeout: int | None = None
) -> tuple[str, str, int, list[str]]:
    t = timeout if timeout is not None else _effective_timeout_sec()
    agent_dir = _hermes_agent_dir()
    env = os.environ.copy()
    env.setdefault("HERMES_HOME", str(_hermes_home()))
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=t,
            env=env,
            cwd=str(agent_dir) if agent_dir.is_dir() else None,
        )
        return proc.stdout or "", proc.stderr or "", int(proc.returncode), cmd
    except subprocess.TimeoutExpired:
        return "", f"timeout {t}s", -1, cmd
    except (FileNotFoundError, OSError):
        return "", "hermes launcher not found", -1, cmd


def parse_sessions_list_stdout(text: str) -> list[dict[str, str]]:
    """Parse `hermes sessions list` table output; returns [{id, label}]."""
    if not text or not text.strip():
        return []
    sessions: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line or line.startswith("─") or line.startswith("-"):
            continue
        low = line.lower()
        if low.startswith("title ") and "preview" in low:
            continue
        if low.startswith("preview ") and "last active" in low:
            continue
        m = _SESSION_ID_IN_LINE_RE.search(line)
        if not m:
            continue
        sid = m.group(1)
        if sid in seen:
            continue
        seen.add(sid)
        label = line[: m.start()].strip()
        label = " ".join(label.split()) if label else sid
        if label.startswith("\u2014"):
            label = ">" + label[1:]
        elif label.startswith("\u2013"):
            label = ">" + label[1:]
        if len(label) > 80:
            label = label[:77] + "..."
        sessions.append({"id": sid, "label": label})
    return sessions


def list_sessions_for_profile(profile: str) -> dict:
    """
    Run Hermes CLI `sessions list` scoped to --profile (cursor-style hermes_cli.main).
    On failure, returns sessions: [] and error stderr or a short message.
    """
    ok, err = validate_profile_name(profile)
    if not ok:
        return {"sessions": [], "error": err, "stderr": err}
    launcher = _hermes_launcher_argv()
    candidates = [
        launcher + ["--profile", profile, "sessions", "list", "--limit", "100"],
        launcher + ["--profile", profile, "sessions", "list"],
    ]
    last_stderr = ""
    for cmd in candidates:
        out, stderr, rc, _ = _run_hermes_argv(cmd, timeout=min(120, _effective_timeout_sec()))
        last_stderr = (stderr or "").strip()
        if rc == 0:
            return {
                "sessions": parse_sessions_list_stdout(out),
                "error": None,
                "stderr": None,
            }
    return {
        "sessions": [],
        "error": "Could not list sessions (is `sessions list` supported for this Hermes build?)",
        "stderr": last_stderr or None,
    }


def run_hermes_chat(profile: str, message: str, resume_session_id: str | None = None) -> dict:
    """
    Run one Hermes chat turn. Returns dict with stdout, stderr, returncode, command, error (optional).
    On launcher missing, error key is set and returncode -1.
    """
    ok, err = validate_profile_name(profile)
    if not ok:
        return {
            "profile": profile,
            "stdout": "",
            "stderr": err,
            "returncode": -1,
            "command": [],
            "error": err,
        }

    msg = message.strip()
    if not msg:
        return {
            "profile": profile,
            "stdout": "",
            "stderr": "empty message",
            "returncode": -1,
            "command": [],
            "error": "empty message",
        }

    cmd = build_chat_argv(profile, msg, resume_session_id=resume_session_id)
    timeout = _effective_timeout_sec()
    out, stderr, rc, cmd = _run_hermes_argv(cmd, timeout=timeout)
    if rc == -1:
        err = None
        if "hermes launcher not found" in (stderr or ""):
            err = "not found"
        elif (stderr or "").strip().lower().startswith("timeout"):
            err = "timeout"
        return {
            "profile": profile,
            "stdout": out,
            "stderr": stderr,
            "returncode": -1,
            "command": cmd,
            "error": err,
        }

    if _effective_strip_cli_output():
        out = clean_hermes_cli_stdout(out)

    return {
        "profile": profile,
        "stdout": out,
        "stderr": stderr,
        "returncode": rc,
        "command": cmd,
    }
