"""Scheduled jobs: same Hermes chat subprocess as manual Send; schedule strings match AgentChat (cursor-agent-chat)."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

import hermes_runner
import history_store

_file_lock = threading.Lock()
_sched_start_lock = threading.Lock()
_scheduler: BackgroundScheduler | None = None

_log = logging.getLogger(__name__)

_INTERVAL_CAP = {"s": 86400, "m": 43200, "h": 8760, "d": 366}

# APScheduler passes job args back unchanged; JSON "id" may be int. Normalize everywhere.
def _norm_job_id(raw: Any) -> str:
    if raw is None:
        return ""
    return str(raw).strip()


def _crons_path() -> Path:
    return history_store._data_dir() / "crons.json"


def _load_jobs_list() -> list[dict[str, Any]]:
    p = _crons_path()
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "jobs" in data:
            return list(data["jobs"])
    except (json.JSONDecodeError, OSError):
        pass
    return []


def _save_jobs_list(jobs: list[dict[str, Any]]) -> None:
    p = _crons_path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def _cap(n: int, u: str) -> int:
    return max(1, min(int(n), _INTERVAL_CAP.get(u, 43200)))


def job_schedule_str(job: dict[str, Any]) -> str:
    """Canonical AgentChat-style schedule string (interval:|cron:|date:)."""
    s = job.get("schedule")
    if isinstance(s, str) and s.strip():
        return s.strip()
    st = job.get("schedule_type")
    if st == "once" and job.get("run_at") is not None:
        try:
            ts = float(job["run_at"])
        except (TypeError, ValueError):
            pass
        else:
            return "date:" + datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    if st == "interval" or job.get("every_minutes") is not None or job.get("interval_value") is not None:
        v = int(job.get("interval_value") or job.get("every_minutes") or 5)
        u = str(job.get("interval_unit") or "minutes")
        ch = {"minutes": "m", "hours": "h", "days": "d"}.get(u, "m")
        return f"interval:{_cap(v, ch)}{ch}"
    return "interval:15m"


def _parse_date_payload(raw: str) -> datetime:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise ValueError("invalid date schedule")


def trigger_from_schedule(schedule: str) -> IntervalTrigger | DateTrigger | CronTrigger:
    s = schedule.strip()
    if not s:
        raise ValueError("empty schedule")
    if s.startswith("interval:"):
        rest = s[9:].strip()
        m = re.match(r"^(\d+)([smhd])$", rest)
        if not m:
            raise ValueError("invalid interval schedule (use interval:Nm, Nh, or Nd like AgentChat)")
        n, u = int(m.group(1)), m.group(2)
        if u == "s":
            return IntervalTrigger(seconds=_cap(n, "s"))
        if u == "m":
            return IntervalTrigger(minutes=_cap(n, "m"))
        if u == "h":
            return IntervalTrigger(hours=_cap(n, "h"))
        return IntervalTrigger(days=_cap(n, "d"))
    if s.startswith("date:"):
        dt = _parse_date_payload(s[5:])
        return DateTrigger(run_date=dt)
    if s.startswith("cron:"):
        expr = s[5:].strip()
        if not expr:
            raise ValueError("empty cron expression")
        return CronTrigger.from_crontab(expr)
    raise ValueError("schedule must start with interval:, date:, or cron:")


def validate_schedule(schedule: str) -> None:
    trigger_from_schedule(schedule)


def list_jobs() -> list[dict[str, Any]]:
    with _file_lock:
        raw = _load_jobs_list()
    out: list[dict[str, Any]] = []
    for j in json.loads(json.dumps(raw)):
        jj = dict(j)
        jj["schedule"] = job_schedule_str(jj)
        out.append(jj)
    return out


def _find_job(jobs: list[dict], job_id: str | Any) -> dict | None:
    want = _norm_job_id(job_id)
    if not want:
        return None
    for j in jobs:
        if _norm_job_id(j.get("id")) == want:
            return j
    return None


def _strip_legacy_schedule_keys(job: dict[str, Any]) -> None:
    for k in (
        "schedule_type",
        "interval_value",
        "interval_unit",
        "every_minutes",
        "run_at",
    ):
        job.pop(k, None)


def execute_job(job_id: str | Any) -> None:
    job_id = _norm_job_id(job_id)
    if not job_id:
        _log.warning("execute_job called with empty job id")
        return
    with _file_lock:
        jobs = _load_jobs_list()
        job = _find_job(jobs, job_id)
        if not job:
            _log.warning("execute_job: no job with id %r in crons.json (check id type / file)", job_id)
            return
        en = job.get("enabled", True)
        if isinstance(en, str):
            en = en.strip().lower() in ("1", "true", "yes", "on")
        if not en:
            return
        profile = job["profile"]
        prompt = job["prompt"]
        name = job.get("name") or job_id
        sched = job_schedule_str(job)
        one_shot = sched.startswith("date:")

    result = None
    err = ""
    rc = 0
    try:
        result = hermes_runner.run_hermes_chat(profile, prompt)
        out = result.get("stdout") or ""
        err = result.get("stderr") or ""
        rc = int(result.get("returncode") or 0)
        if err.strip():
            out = out + ("\n\n" if out else "") + "[stderr]\n" + err
        if rc != 0:
            out += ("\n\n" if out else "") + f"[exit {rc}]"
        if not out.strip():
            out = "(empty output)"
    except Exception as ex:
        _log.exception("cron job %s hermes run failed", job_id)
        out = f"(scheduler error)\n{type(ex).__name__}: {ex}"
        err = str(ex)
        rc = 1

    tag = f"Cron · {name}"
    try:
        history_store.append_exchange(profile, prompt, out, tag=tag)
    except Exception:
        _log.exception("cron job %s could not append chat history", job_id)

    last_err = None
    if result is not None:
        last_err = result.get("error") or (err[:2000] if rc != 0 else None)
    elif rc != 0:
        last_err = err[:2000] if err else "exception during run"

    with _file_lock:
        jobs = _load_jobs_list()
        job = _find_job(jobs, job_id)
        if job:
            job["last_run_at"] = time.time()
            job["last_output"] = out[:8000]
            job["last_returncode"] = rc
            job["last_error"] = last_err
            if one_shot:
                job["enabled"] = False
            _save_jobs_list(jobs)

    if one_shot:
        reschedule_all()


def _schedule_one(sched: BackgroundScheduler, job: dict[str, Any]) -> None:
    jid = _norm_job_id(job.get("id"))
    if not jid:
        _log.warning("skip schedule: job missing id: %s", job)
        return
    try:
        sched.remove_job(f"cron_{jid}")
    except Exception:
        pass
    en = job.get("enabled", True)
    if isinstance(en, str):
        en = en.strip().lower() in ("1", "true", "yes", "on")
    if not en:
        return
    s = job_schedule_str(job)
    trigger: IntervalTrigger | DateTrigger | CronTrigger | None = None
    if s.startswith("date:"):
        try:
            dt = _parse_date_payload(s[5:])
        except ValueError as e:
            _log.warning("skip job %s: bad date schedule %r: %s", jid, s, e)
            return
        if dt.timestamp() <= time.time():
            _log.warning(
                "skip job %s: date schedule is in the past (%s); edit job or use a future time",
                jid,
                s,
            )
            return
        trigger = DateTrigger(run_date=dt)
    else:
        try:
            trigger = trigger_from_schedule(s)
        except ValueError as e:
            _log.warning("skip job %s: invalid schedule %r: %s", jid, s, e)
            return
    try:
        sched.add_job(
            execute_job,
            trigger,
            id=f"cron_{jid}",
            replace_existing=True,
            args=[jid],
            max_instances=1,
            coalesce=True,
            misfire_grace_time=86_400,
        )
    except Exception:
        _log.exception("add_job failed for %s schedule %r", jid, s)
        return
    _log.info("scheduled job %s (%s) -> %s", jid, job.get("name", ""), s)


def reschedule_all() -> None:
    ensure_scheduler_started()
    jobs = list_jobs()
    for j in jobs:
        _schedule_one(_scheduler, j)


def create_job(name: str, profile: str, prompt: str, schedule: str, enabled: bool = True) -> dict:
    ok, _ = hermes_runner.validate_profile_name(profile)
    if not ok:
        raise ValueError("invalid profile")
    sched = schedule.strip()
    validate_schedule(sched)
    job: dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "name": name.strip() or "job",
        "profile": profile,
        "prompt": prompt.strip(),
        "schedule": sched,
        "enabled": enabled,
        "last_run_at": None,
        "last_output": None,
        "last_returncode": None,
        "last_error": None,
    }
    with _file_lock:
        jobs = _load_jobs_list()
        jobs.append(job)
        _save_jobs_list(jobs)
    ensure_scheduler_started()
    _schedule_one(_scheduler, job)
    return dict(job)


def update_job(job_id: str, patch: dict[str, Any]) -> dict | None:
    want = _norm_job_id(job_id)
    with _file_lock:
        jobs = _load_jobs_list()
        job = _find_job(jobs, want)
        if not job:
            return None
        if "name" in patch and patch["name"] is not None:
            job["name"] = str(patch["name"]).strip() or job["name"]
        if "profile" in patch and patch["profile"] is not None:
            ok, _ = hermes_runner.validate_profile_name(str(patch["profile"]))
            if not ok:
                raise ValueError("invalid profile")
            job["profile"] = str(patch["profile"])
        if "prompt" in patch and patch["prompt"] is not None:
            job["prompt"] = str(patch["prompt"]).strip()
        if "enabled" in patch:
            job["enabled"] = bool(patch["enabled"])
        if "schedule" in patch and patch["schedule"] is not None:
            sched = str(patch["schedule"]).strip()
            validate_schedule(sched)
            job["schedule"] = sched
            _strip_legacy_schedule_keys(job)
        _save_jobs_list(jobs)
        out = dict(job)
    out["schedule"] = job_schedule_str(out)
    reschedule_all()
    return out


def delete_job(job_id: str) -> bool:
    global _scheduler
    want = _norm_job_id(job_id)
    with _file_lock:
        jobs = _load_jobs_list()
        new = [j for j in jobs if _norm_job_id(j.get("id")) != want]
        if len(new) == len(jobs):
            return False
        _save_jobs_list(new)
    if _scheduler:
        try:
            _scheduler.remove_job(f"cron_{want}")
        except Exception:
            pass
    return True


def run_job_now(job_id: str) -> None:
    execute_job(job_id)


def scheduler_status() -> dict[str, Any]:
    """Debug: APScheduler registrations vs disk (next_run_time, etc.)."""
    ensure_scheduler_started()
    sch = _scheduler
    if sch is None:
        return {"scheduler_running": False, "apscheduler_jobs": [], "disk_jobs": len(list_jobs())}
    rows: list[dict[str, Any]] = []
    for aj in sch.get_jobs():
        nrt = aj.next_run_time
        rows.append(
            {
                "apscheduler_id": aj.id,
                "next_run_time": nrt.isoformat() if nrt else None,
                "trigger": str(aj.trigger),
            }
        )
    return {
        "scheduler_running": getattr(sch, "running", False),
        "apscheduler_jobs": rows,
        "disk_jobs": len(list_jobs()),
    }


def ensure_scheduler_started() -> None:
    """Start APScheduler if needed (lifespan may be disabled, e.g. uvicorn --lifespan off)."""
    global _scheduler
    if _scheduler is not None:
        return
    with _sched_start_lock:
        if _scheduler is not None:
            return
        sch = BackgroundScheduler()
        boot_jobs = list_jobs()
        for j in boot_jobs:
            try:
                _schedule_one(sch, j)
            except Exception:
                _log.exception("boot schedule failed for job %s", j.get("id"))
        try:
            sch.start()
        except Exception:
            _log.exception("APScheduler.start() failed")
            raise
        _scheduler = sch
        _log.info("APScheduler started (%s jobs from disk)", len(boot_jobs))


def start_scheduler() -> None:
    ensure_scheduler_started()


def shutdown_scheduler() -> None:
    global _scheduler
    with _sched_start_lock:
        if _scheduler is not None:
            _scheduler.shutdown(wait=False)
            _scheduler = None
