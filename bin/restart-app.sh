#!/bin/bash
# Restart the DS Bot app from outside it: a launchd one-shot job starts this script, so the
# quit it performs does not kill the restart itself. Never call `open` on a dead Aqua
# session — launchd gives the one that works.
#
#   launchctl submit -l ds-bot-restart -- /bin/bash <repo>/bin/restart-app.sh --times 3
#
# Every run records the pid before and after, and whether the app was still up ten seconds
# later. A run that ends with no pid is reported as FAILED, not retried silently.
set -u

APP="/Applications/DS Bot.app"
BUNDLE="io.github.fei2411.dsbot"
JOB="${DS_BOT_RESTART_JOB:-ds-bot-restart}"
LOG="${DS_BOT_RESTART_LOG:-$HOME/.ds-bot/restart-app.log}"
TIMES=1
while [ $# -gt 0 ]; do
  case "$1" in
    --times) TIMES="${2:-1}"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
exe_pid() { pgrep -f '^/Applications/DS Bot\.app/Contents/MacOS/DS Bot$' | head -1; }
# The job must go away by itself, or launchd runs it again about every ten seconds.
finish() { launchctl remove "$JOB" >/dev/null 2>&1 || true; }
trap finish EXIT

for run in $(seq 1 "$TIMES"); do
  before=$(exe_pid || true)
  osascript -e "tell application id \"$BUNDLE\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    [ -z "$(exe_pid)" ] && break
    sleep 0.5
  done
  open -ga "$APP" >/dev/null 2>&1 || true
  after=""
  for _ in $(seq 1 60); do
    after=$(exe_pid || true)
    [ -n "$after" ] && break
    sleep 0.5
  done
  say "run=$run before=${before:-none} after=${after:-none}"
  sleep 10
  alive=$(exe_pid || true)
  if [ -n "$alive" ]; then
    say "  alive_after_10s=$alive"
  else
    say "  FAILED: the app was not up ten seconds later"
  fi
done
say "done"
