"""Quick check that profile file routes work (no server on port needed)."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Repo root = parent of scripts/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

tmpdir = tempfile.mkdtemp(prefix="hermes-ui-test-")
os.environ["HERMES_HOME"] = tmpdir
prof_dir = Path(tmpdir) / "profiles" / "algobot"
prof_dir.mkdir(parents=True)
(prof_dir / "SOUL.md").write_text("soul-test-ok\n", encoding="utf-8")

from fastapi.testclient import TestClient

import server

client = TestClient(server.app)

r = client.get("/api/profiles/algobot/files/SOUL.md")
assert r.status_code == 200, r.text
j = r.json()
assert j["exists"] is True
assert "soul-test-ok" in j["content"]

r2 = client.get("/api/profile-file", params={"profile": "algobot", "filename": "SOUL.md"})
assert r2.status_code == 200, r2.text

r3 = client.post("/api/profile-file-read", json={"profile": "algobot", "filename": "SOUL.md"})
assert r3.status_code == 200, r3.text

r4 = client.put(
    "/api/profile-file",
    json={"profile": "algobot", "filename": "SOUL.md", "content": "updated\n"},
)
assert r4.status_code == 200, r4.text
assert (prof_dir / "SOUL.md").read_text() == "updated\n"

print("OK: path GET, query GET, POST read, PUT body all work")
