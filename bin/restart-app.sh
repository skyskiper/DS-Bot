#!/bin/bash
# Restart the DS Bot app from outside it. A launchd one-shot job runs this script, so the
# quit it performs cannot kill the restart itself; `open` from a plain shell is unreliable
# (two failures in three tries on 2026-11-14), a submitted job runs in the user's session.
#
#   bin/restart-app.sh                 restart once
#   bin/restart-app.sh --times 3       three restarts in a row, each recorded
#
# Every run: SIGTERM the old process, wait up to 15s, SIGKILL if it is still there, open the
# app, wait for a pid, then check it is still up ten seconds later. A run with no live pid
# is written down as FAILED with this log's path; nothing retries silently.
set -u

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
APP="/Applications/DS Bot.app"
JOB="${DS_BOT_RESTART_JOB:-ds-bot-restart}"
LOG="${DS_BOT_RESTART_LOG:-$HOME/.ds-bot/restart-app.log}"
mkdir -p "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
# The app's own process: pgrep's anchored pattern misses it, and helpers are not it.
exe_pid() { ps -eo pid=,command= | awk '$2 == "/Applications/DS" && $3 == "Bot.app/Contents/MacOS/DS" && $4 == "Bot" { print $1 }' | head -1; }

if [ "${1:-}" = "--job" ]; then
  trap 'launchctl remove "$JOB" >/dev/null 2>&1 || true' EXIT
  for run in $(seq 1 "${2:-1}"); do
    before=$(exe_pid || true)
    if [ -n "$before" ]; then
      kill -TERM "$before" 2>/dev/null || true
      for _ in $(seq 1 30); do
        [ -z "$(exe_pid)" ] && break
        sleep 0.5
      done
      if [ -n "$(exe_pid)" ]; then
        say "run=$run kill9 pid=$(exe_pid)"
        kill -9 "$(exe_pid)" 2>/dev/null || true
        sleep 1
      fi
    fi
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
    if [ -n "$alive" ]; then say "  alive_after_10s=$alive"
    else say "  FAILED: the app was not up ten seconds later (log: $LOG)"; fi
  done
  say "done"
  exit 0
fi

TIMES=1
while [ $# -gt 0 ]; do
  case "$1" in
    --times) TIMES="${2:-1}"; shift 2 ;;
    *) shift ;;
  esac
done
launchctl submit -l "$JOB" -- /bin/bash "$SELF" --job "$TIMES" || { say "submit failed for $JOB"; exit 2; }
for _ in $(seq 1 180); do
  launchctl list 2>/dev/null | awk -v name="$JOB" '$3 == name { found = 1 } END { exit found ? 0 : 1 }' || break
  sleep 1
done
launchctl remove "$JOB" >/dev/null 2>&1 || true
say "job $JOB finished"
