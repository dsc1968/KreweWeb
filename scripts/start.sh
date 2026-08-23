#!/usr/bin/env bash
# npm start helper.
#
# Kills any existing server bound to the port, waits for the socket to be
# released, then starts a brand-new server process. (Node has no compile
# step, so a "clean" start is simply a fresh process with no stale state; the
# server also re-runs its schema/ensure step on boot, so the DB is brought
# up to date automatically.)

PORT="${PORT:-8000}"

# 1) Stop any previously running server. We match the server's command line
#    (relative or absolute path) so this also catches servers started outside
#    this script. `pkill -f` uses the pattern as a regex against the full
#    command line, and the path substring "backend/server.js" is present in
#    both `node backend/server.js` and an absolute-path invocation.
if pkill -f "backend/server\.js" 2>/dev/null; then
  echo "Stopped existing server process(es)."
else
  echo "No existing server process matched."
fi

# 2) Belt-and-suspenders: free the port directly in case a process is
#    lingering or was started in a way we didn't match above.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:"${PORT}" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# 3) Give the OS a moment to release the socket before we rebind.
sleep 1

# 4) Start fresh. `exec` replaces this shell with the server so that `npm`
#    stays attached to the server process and Ctrl+C / stop propagate
#    correctly (no orphaned background process).
echo "Starting server (clean) on port ${PORT}..."
exec node backend/server.js
