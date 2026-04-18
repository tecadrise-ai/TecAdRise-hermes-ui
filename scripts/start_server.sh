#!/bin/sh
fuser -k -9 9090/tcp 2>/dev/null || true
sleep 1
cd /mnt/c/TecAdRise/projects-git/hermes-minimal-ui || exit 1
exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 9090
