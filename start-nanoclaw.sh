#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /home/mrich/nanoclaw/nanoclaw.pid)

set -euo pipefail

cd "/home/mrich/nanoclaw"

# Stop existing instance if running
if [ -f "/home/mrich/nanoclaw/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/home/mrich/nanoclaw/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
nohup "/home/mrich/.nvm/versions/node/v24.16.0/bin/node" "/home/mrich/nanoclaw/dist/index.js" \
  >> "/home/mrich/nanoclaw/logs/nanoclaw.log" \
  2>> "/home/mrich/nanoclaw/logs/nanoclaw.error.log" &

echo $! > "/home/mrich/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/mrich/nanoclaw/logs/nanoclaw.log"
