"""
Minimal Hermes chat shell: 3-pane layout, CLI subprocess, server history, scheduled crons.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import cron_service
import hermes_runner
import history_store

STATIC_DIR = Path(__file__).resolve().parent / "static"
UI_CONFIG_PATH = Path(__file__).resolve().parent / "config.toml"


def _strip_ts(msgs: list) -> list[dict]:
    out = []
    for m in msgs:
        if isinstance(m, dict):
            item = {"role": m.get("role", ""), "text": m.get("text", "")}
            ts = m.get("ts")
            if isinstance(ts, (int, float)):
                item["ts"] = float(ts)
            out.append(item)
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    cron_service.start_scheduler()
    yield
    cron_service.shutdown_scheduler()


app = FastAPI(title="Hermes minimal UI", lifespan=lifespan)


class ChatRequest(BaseModel):
    profile: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1, max_length=200_000)
    resume_session_id: str | None = Field(None, max_length=256)


class ChatResponse(BaseModel):
    profile: str
    stdout: str
    stderr: str
    returncode: int
    command: list[str]
    messages: list[dict] = Field(default_factory=list)
    rev: int = 0


class CronCreate(BaseModel):
    """Schedule strings match AgentChat (cursor-agent-chat): interval:15m, cron:..., date:...."""

    name: str = Field(..., min_length=1, max_length=120)
    profile: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1, max_length=200_000)
    schedule: str = Field(..., min_length=3, max_length=512)
    enabled: bool = True


class CronPatch(BaseModel):
    name: str | None = Field(None, max_length=120)
    profile: str | None = None
    prompt: str | None = Field(None, max_length=200_000)
    enabled: bool | None = None
    schedule: str | None = Field(None, min_length=3, max_length=512)


class ProfileFileWrite(BaseModel):
    content: str = Field(default="", max_length=2_000_000)


class ProfileFilePutBody(BaseModel):
    profile: str = Field(..., min_length=1)
    filename: str = Field(..., min_length=1)
    content: str = Field(default="", max_length=2_000_000)


class ProfileFileKey(BaseModel):
    profile: str = Field(..., min_length=1)
    filename: str = Field(..., min_length=1)


class SessionsListBody(BaseModel):
    profile: str = Field(..., min_length=1)


class ProfileSkillCategoryBody(BaseModel):
    profile: str = Field(..., min_length=1)
    category: str = Field(..., min_length=1, max_length=256)


class UiConfigWrite(BaseModel):
    content: str = Field(default="", max_length=2_000_000)


def _profile_file_get_json(profile: str, filename: str) -> dict:
    allowed = set(hermes_runner.get_profile_file_names())
    if filename not in allowed:
        raise HTTPException(400, "file not listed in profile_files in config.toml")
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    try:
        content, exists = hermes_runner.read_profile_sidecar_file(profile, filename)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {
        "profile": profile,
        "filename": filename,
        "content": content,
        "exists": exists,
    }


def _profile_file_put_do(profile: str, filename: str, content: str) -> dict:
    allowed = set(hermes_runner.get_profile_file_names())
    if filename not in allowed:
        raise HTTPException(400, "file not listed in profile_files in config.toml")
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    try:
        hermes_runner.write_profile_sidecar_file(profile, filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except OSError as e:
        raise HTTPException(500, str(e)) from e
    return {"ok": True, "profile": profile, "filename": filename}


@app.get("/api/health")
def health():
    st = hermes_runner.get_effective_chat_settings()
    return {
        "ok": True,
        "hermes_launcher": hermes_runner.get_launcher_argv(),
        "hermes_bin": " ".join(hermes_runner.get_launcher_argv()),
        "hermes_home": str(hermes_runner.get_hermes_home()),
        "hermes_agent_dir": str(hermes_runner.get_agent_dir()),
        "chat_quiet_default": st["adds_quiet_flag"],
        "hermes_chat_settings": st,
        "ui": hermes_runner.get_ui_text(),
    }


@app.get("/api/cli-preview")
def api_cli_preview(
    profile: str | None = Query(default=None),
    resume_session_id: str | None = Query(default=None, max_length=256),
):
    """Same argv shape as Send/cron; message shown as <message> placeholder."""
    settings = hermes_runner.get_effective_chat_settings()
    ui = hermes_runner.get_ui_text()
    profs = hermes_runner.list_profile_names()
    agent_dir = hermes_runner.get_agent_dir()
    cwd = str(agent_dir) if agent_dir.is_dir() else None

    rid = (resume_session_id or "").strip()
    ok_rid, rid_err = hermes_runner.validate_resume_session_id(rid)
    resume_arg = rid if ok_rid and rid else None
    if not ok_rid:
        resume_arg = None

    if not profs:
        argv = hermes_runner.build_chat_argv("<profile>", "<message>", resume_session_id=resume_arg)
        return {
            "profile": None,
            "argv": argv,
            "display": hermes_runner.chat_command_display(argv),
            "cwd": cwd,
            "settings": settings,
            "ui": ui,
            "no_profiles": True,
            "warning": None if ok_rid else rid_err,
        }

    want = profile.strip() if profile and profile.strip() else ""
    resolved, warning = hermes_runner.resolve_profile_for_preview(want, profs)

    argv = hermes_runner.build_chat_argv(resolved, "<message>", resume_session_id=resume_arg)
    w = warning
    if not ok_rid and rid_err:
        w = (w + "; " if w else "") + rid_err
    return {
        "profile": resolved,
        "argv": argv,
        "display": hermes_runner.chat_command_display(argv),
        "cwd": cwd,
        "settings": settings,
        "ui": ui,
        "no_profiles": False,
        "warning": w,
    }


@app.get("/api/scheduler-status")
def api_scheduler_status_top():
    """Alias without /crons/... so it never collides with /api/crons/{job_id} on any stack."""
    cron_service.ensure_scheduler_started()
    return cron_service.scheduler_status()


@app.get("/api/profiles")
def api_profiles(
    sessions_profile: str | None = Query(
        default=None,
        description="When set, response includes sessions_list for that profile (proxies often allow /api/profiles but block /api/sessions).",
    ),
):
    out: dict = {
        "profiles": hermes_runner.list_profile_names(),
        "hermes_home": str(hermes_runner.get_hermes_home()),
        "profile_files": hermes_runner.get_profile_file_names(),
    }
    if sessions_profile is not None and sessions_profile.strip():
        sp = sessions_profile.strip()
        ok, err = hermes_runner.validate_profile_name(sp)
        if ok:
            out["sessions_list"] = hermes_runner.list_sessions_for_profile(sp)
        else:
            out["sessions_list"] = {"sessions": [], "error": err, "stderr": err}
    return out


@app.post("/api/profiles-sessions")
def api_profiles_sessions_post(body: SessionsListBody):
    """Same payload as /api/sessions-read; path under /api/profiles* for strict proxies that strip GET query strings."""
    return _sessions_list_json(body.profile)


@app.get("/api/profiles/{profile}/files/{filename}")
def api_profile_file_get_path(profile: str, filename: str):
    return _profile_file_get_json(profile, filename)


@app.get("/api/profile-file")
def api_profile_file_get_query(
    profile: str = Query(..., min_length=1),
    filename: str = Query(..., min_length=1),
):
    """Same as GET /api/profiles/{profile}/files/{filename}; query form works behind strict reverse proxies."""
    return _profile_file_get_json(profile, filename)


@app.put("/api/profiles/{profile}/files/{filename}")
def api_profile_file_put_path(profile: str, filename: str, body: ProfileFileWrite):
    return _profile_file_put_do(profile, filename, body.content)


@app.put("/api/profile-file")
def api_profile_file_put_query(body: ProfileFilePutBody):
    """Same as path PUT; JSON body includes profile and filename."""
    return _profile_file_put_do(body.profile, body.filename, body.content)


@app.post("/api/profile-file-read")
def api_profile_file_read_post(body: ProfileFileKey):
    """Same as GET routes; POST avoids proxies that block GET with query or dotted path segments."""
    return _profile_file_get_json(body.profile, body.filename)


@app.post("/api/profile-file-write")
def api_profile_file_write_post(body: ProfileFilePutBody):
    """Same as PUT routes; POST for strict proxies."""
    return _profile_file_put_do(body.profile, body.filename, body.content)


@app.post("/api/profile-upload")
async def api_profile_upload(
    profile: str = Form(..., min_length=1),
    file: UploadFile = File(...),
):
    """Save one file under HERMES_HOME/profiles/<profile>/uploads/ for chat attachments."""
    p = profile.strip()
    ok, err = hermes_runner.validate_profile_name(p)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    try:
        raw = await file.read()
        path = hermes_runner.save_profile_upload(p, file.filename or "upload.bin", raw)
    except ValueError as e:
        msg = str(e)
        code = 413 if "too large" in msg.lower() else 400
        raise HTTPException(code, msg) from e
    except OSError as e:
        raise HTTPException(500, str(e)) from e
    return {"ok": True, "path": str(path), "filename": path.name}


def _ui_config_read_json() -> dict:
    path = UI_CONFIG_PATH
    exists = path.is_file()
    text = ""
    if exists:
        text = path.read_text(encoding="utf-8")
    return {"path": str(path), "exists": exists, "content": text}


def _ui_config_write_do(content: str) -> dict:
    path = UI_CONFIG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(path)}


@app.get("/api/ui-config")
def api_ui_config_get():
    return _ui_config_read_json()


@app.post("/api/ui-config-read")
def api_ui_config_read_post():
    """POST for strict proxies (same pattern as profile-file-read)."""
    return _ui_config_read_json()


@app.put("/api/ui-config")
def api_ui_config_put(body: UiConfigWrite):
    return _ui_config_write_do(body.content)


@app.post("/api/ui-config-write")
def api_ui_config_write_post(body: UiConfigWrite):
    return _ui_config_write_do(body.content)


@app.get("/api/history/{profile}")
def api_history(profile: str):
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400, err)
    msgs, rev = history_store.get_profile_messages(profile)
    return {"profile": profile, "messages": _strip_ts(msgs), "rev": rev}


def _sessions_list_json(profile: str) -> dict:
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    return hermes_runner.list_sessions_for_profile(profile)


def _skill_categories_json(profile: str) -> dict:
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    return {"categories": hermes_runner.list_skill_categories_for_profile(profile)}


def _skills_in_category_json(profile: str, category: str) -> dict:
    ok, err = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    cat = category.strip()
    if not hermes_runner.skill_segment_ok(cat):
        raise HTTPException(400, "invalid skill category")
    return hermes_runner.skills_panel_for_profile_category(profile, cat)


@app.get("/api/sessions")
def api_sessions_query(profile: str = Query(..., min_length=1)):
    """Query form for strict reverse proxies that mishandle path segments on GET."""
    return _sessions_list_json(profile)


@app.post("/api/sessions-read")
def api_sessions_read_post(body: SessionsListBody):
    """POST body form, same idea as /api/profile-file-read for strict proxies."""
    return _sessions_list_json(body.profile)


@app.get("/api/sessions/{profile}")
def api_sessions_path(profile: str):
    return _sessions_list_json(profile)


@app.get("/api/profiles/{profile}/skill-categories")
def api_skill_categories_path(profile: str):
    """List category folder names under profiles/<profile>/skills/."""
    return _skill_categories_json(profile)


@app.post("/api/profile-skill-categories-read")
def api_profile_skill_categories_read_post(body: SessionsListBody):
    """POST for strict proxies (same pattern as profile-file-read)."""
    return _skill_categories_json(body.profile)


@app.get("/api/profiles/{profile}/skill-categories/{category}/skills")
def api_skills_in_category_path(profile: str, category: str):
    """List skill folder names under profiles/<profile>/skills/<category>/."""
    return _skills_in_category_json(profile, category)


@app.post("/api/profile-skills-read")
def api_profile_skills_read_post(body: ProfileSkillCategoryBody):
    """POST for strict proxies."""
    return _skills_in_category_json(body.profile, body.category)


@app.post("/api/chat", response_model=ChatResponse)
def api_chat(body: ChatRequest):
    ok, err = hermes_runner.validate_profile_name(body.profile)
    if not ok:
        raise HTTPException(400 if "invalid" in err else 404, err)
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "empty message")

    rid = (body.resume_session_id or "").strip()
    ok_rid, rid_err = hermes_runner.validate_resume_session_id(rid)
    if not ok_rid:
        raise HTTPException(400, rid_err)
    resume = rid if rid else None

    result = hermes_runner.run_hermes_chat(body.profile, msg, resume_session_id=resume)
    if result.get("error") == "timeout":
        raise HTTPException(504, result.get("stderr", "timeout"))
    if result.get("error") == "not found":
        raise HTTPException(500, "hermes launcher not found")

    out = result.get("stdout") or ""
    err_s = result.get("stderr") or ""
    rc = int(result.get("returncode") or 0)
    if err_s.strip():
        out = out + ("\n\n" if out else "") + "[stderr]\n" + err_s
    if rc != 0:
        out += ("\n\n" if out else "") + f"[exit {rc}]"
    if not out.strip():
        out = "(empty output)"

    messages, rev = history_store.append_exchange(body.profile, msg, out, tag=None)

    return ChatResponse(
        profile=body.profile,
        stdout=result.get("stdout") or "",
        stderr=err_s,
        returncode=rc,
        command=list(result.get("command") or []),
        messages=_strip_ts(messages),
        rev=rev,
    )


@app.get("/api/crons")
def api_crons_list():
    cron_service.ensure_scheduler_started()
    jobs = cron_service.list_jobs()
    cron_service.attach_next_run_times(jobs)
    for j in jobs:
        if j.get("last_run_at"):
            j["last_run_at"] = float(j["last_run_at"])
        nra = j.get("next_run_at")
        if nra is not None:
            j["next_run_at"] = float(nra)
    return {"jobs": jobs}


@app.get("/api/crons/scheduler-status")
def api_crons_scheduler_status():
    """Debug: confirm APScheduler has jobs and next_run_time (open in browser if cron never fires)."""
    return cron_service.scheduler_status()


@app.post("/api/crons")
def api_crons_create(body: CronCreate):
    cron_service.ensure_scheduler_started()
    try:
        job = cron_service.create_job(
            body.name,
            body.profile,
            body.prompt,
            body.schedule.strip(),
            body.enabled,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"job": job}


@app.patch("/api/crons/{job_id}")
def api_crons_patch(job_id: str, body: CronPatch):
    cron_service.ensure_scheduler_started()
    patch = body.model_dump(exclude_unset=True)
    if "schedule" in patch and patch["schedule"] is not None:
        patch["schedule"] = str(patch["schedule"]).strip()
    if not patch:
        jobs = cron_service.list_jobs()
        jid = str(job_id).strip()
        job = next((j for j in jobs if str(j.get("id")) == jid), None)
        if not job:
            raise HTTPException(404, "job not found")
        return {"job": job}
    try:
        job = cron_service.update_job(job_id, patch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not job:
        raise HTTPException(404, "job not found")
    return {"job": job}


@app.delete("/api/crons/{job_id}")
def api_crons_delete(job_id: str):
    cron_service.ensure_scheduler_started()
    if not cron_service.delete_job(job_id):
        raise HTTPException(404, "job not found")
    return {"ok": True}


@app.post("/api/crons/{job_id}/run")
def api_crons_run(job_id: str):
    cron_service.ensure_scheduler_started()
    jobs = cron_service.list_jobs()
    jid = str(job_id).strip()
    if not any(str(j.get("id")) == jid for j in jobs):
        raise HTTPException(404, "job not found")

    def _run():
        cron_service.run_job_now(job_id)

    import threading

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "started": True}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
