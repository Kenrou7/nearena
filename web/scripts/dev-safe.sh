#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3300}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"

if [[ -n "$pids" ]]; then
  echo "Port $PORT is already in use."

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue

    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    [[ -z "$cmd" ]] && cmd="<unavailable>"
    pid_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"

    echo "- PID $pid: $cmd"
    if [[ -n "$pid_cwd" ]]; then
      echo "  cwd: $pid_cwd"
    fi

    if [[ "$cmd" == *"$PROJECT_ROOT"* ]] || [[ "$pid_cwd" == "$PROJECT_ROOT"* ]]; then
      echo "Detected an existing Next dev server for this same project."
      echo "Reusing current server and exiting without killing anything."
      exit 0
    fi
  done <<< "$pids"

  echo "Port $PORT is occupied by another process."
  echo "No process was killed. Stop it manually if you want to run this project on $PORT."
  exit 1
fi

echo "Port $PORT is free. Starting Next dev server..."
exec next dev -p "$PORT"
