#!/bin/bash
# Restart the DS Bot app from outside it, the way it is installed: a launchd one-shot job
# in the user's GUI domain, so the quit it performs cannot kill the restart itself.
#
#   bin/restart-app.sh                 restart once
#   bin/restart-app.sh --times 3       three restarts in a row, each recorded
#
# `open` from a dead Aqua session is unreliable (twice in three tries on 2026-11-14); a job
# bootstrapped into gui/<uid> runs in the user's own session, which is why this path works.
# A run that ends with no live pid is written down as FAILED; nothing retries silently.
set -u

APP="/Applications/DS Bot.app"
BUNDLE="io.github.fei2411.dsbot"
LABEL="io.github.fei2411.dsbot.restart.$(date +%s)"
LOG="${DS_BOT_RESTART_LOG:-$HOME/.ds-bot/restart-app.log}"
PLIST="$(mktemp -t ds-bot-restart).plist"
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

# The work the job runs: one restart, recorded.
if [ "${1:-}" = "--job" ]; then
  times="${2:-1}"
  for run in $(seq 1 "$times"); do
    before=$(exe_pid || true)
    if [ -n "$before" ]; then
      kill -TERM "$before" 2>/dev/null || true
      for _ in $(seq 1 30); do
        [ -z "$(exe_pid)" ] && break
        sleep 0.5
      done
      # Still there after fifteen seconds: it is not going to quit on its own.
      if [ -n "$(exe_pid)" ]; then
        say "run=$run kill9 $(exe_pid)"
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

# Schedule that work as a one-shot job in the user's GUI domain, then leave.
cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>$0</string><string>--job</string><string>$TIMES</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST_EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { say "bootstrap failed for $LABEL"; rm -f "$PLIST"; exit 2; }
for _ in $(seq 1 120); do
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
  sleep 1
done
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
say "job $LABEL finished"
