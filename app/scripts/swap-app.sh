#!/bin/bash
# Replace the installed DS Bot app with a freshly packed one.
#
#   app/scripts/swap-app.sh <new .app> [--check] [--force]
#
#   --check   verify the new bundle and print what would happen; change nothing
#   --force   allow the restart-loop guard below to be skipped
#
# Run it DETACHED from the app it replaces: schedule it with launchd, never as a
# child of the app (a child is killed with the app). A one-shot job that removes
# itself afterwards:
#
#   launchctl submit -l ds-bot-swap -- /bin/bash -c \
#     'sleep 3; DS_BOT_SWAP_JOB=ds-bot-swap /path/to/app/scripts/swap-app.sh "/path/to/DS Bot.app"'
#
# `DS_BOT_SWAP_JOB` names that launchd job so the script takes it down at exit; without
# it the job stays in launchd and can run the script again.
#
# Safety rails (the 2026-11-07 restart loop is why they exist):
#   * one swap at a time: lock directory, stale after 15 minutes;
#   * the old app is kept as "DS Bot.app.bak-YYYYmmdd-HHMMSS", never overwritten;
#     the newest three are kept;
#   * the new bundle is verified (executable, signature, version) and signed with this
#     machine's Apple Development identity BEFORE the old one is moved, so the TCC
#     grants follow it; the installed copy is verified again after the move
#     (app/scripts/sign-app.sh);
#   * a failure after the move puts the old app back and opens it again;
#   * a 4th swap of the same bundle within 10 minutes is refused as a restart loop;
#   * every step lands in /tmp/ds-bot-swap.log (DS_BOT_SWAP_LOG overrides).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)

# DS_BOT_APP belongs to the app itself (it is 1 inside the desktop app), never a path.
TARGET="${DS_BOT_SWAP_TARGET:-/Applications/DS Bot.app}"
LOG="${DS_BOT_SWAP_LOG:-}"
[ -n "$LOG" ] || LOG=/tmp/ds-bot-swap.log
LOCK="${DS_BOT_SWAP_LOCK:-/tmp/ds-bot-swap.lock}"
HISTORY="${DS_BOT_SWAP_HISTORY:-/tmp/ds-bot-swap.history}"
KEEP_BACKUPS="${DS_BOT_KEEP_BACKUPS:-3}"

CHECK=0
FORCE=0
NEW=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)
      printf 'swap-app: unknown option %s\n' "$arg" >&2
      exit 2
      ;;
    *) NEW="$arg" ;;
  esac
done
if [ -z "$NEW" ]; then
  printf 'usage: swap-app.sh <new .app> [--check] [--force]\n' >&2
  exit 2
fi

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }
fail() { say "ABORT: $*"; printf 'swap-app: %s\n' "$*" >&2; exit 1; }
version_of() { /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist" 2>/dev/null; }
executable_of() {
  local name
  name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$1/Contents/Info.plist" 2>/dev/null)
  printf '%s/Contents/MacOS/%s' "$1" "${name:-DS Bot}"
}

# --- the new bundle, before anything is touched ---------------------------------
[ -d "$NEW" ] || fail "new app is missing: $NEW"
EXE=$(executable_of "$NEW")
[ -x "$EXE" ] || fail "new app has no executable at $EXE"
if ! codesign -v "$NEW" 2>>"$LOG"; then
  fail "new app does not pass codesign -v: $NEW"
fi
NEWVER=$(version_of "$NEW")
[ -n "$NEWVER" ] || fail "new app has no CFBundleShortVersionString"
say "swap: new=$NEW version=${NEWVER:-?} target=$TARGET check=$CHECK force=$FORCE pid=$$ parent=$(ps -o command= -p "$PPID" 2>/dev/null | cut -c1-120)"

# The grants the user gave the app (Screen Recording, Accessibility) follow the signing
# identity, and a packed app comes ad-hoc: sign it before it lands, or every swap resets
# them. A missing identity is reported, not fatal, unless DS_BOT_REQUIRE_SIGN=1.
sign_new() {
  [ -x "$HERE/sign-app.sh" ] || return 0
  if [ "$CHECK" -eq 1 ]; then
    "$HERE/sign-app.sh" --check "$NEW" 2>&1 | while read -r line; do say "check: $line"; done
    return 0
  fi
  say "swap: signing the new app"
  local out
  if ! out=$("$HERE/sign-app.sh" "$NEW" 2>&1); then
    printf '%s\n' "$out" >>"$LOG"
    fail "could not sign the new app: $NEW"
  fi
  printf '%s\n' "$out" | while read -r line; do say "swap: $line"; done
}

if [ "$CHECK" -eq 1 ]; then
  sign_new
  say "check: ok — would back up $TARGET as $TARGET.bak-<timestamp> and replace it"
  printf 'swap-app: check ok: %s (%s) is ready to replace %s\n' "$NEW" "$NEWVER" "$TARGET"
  exit 0
fi

sign_new

[ -d "$TARGET" ] || fail "the installed app is missing: $TARGET"

# --- one swap at a time ---------------------------------------------------------
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    say "swap: clearing a stale lock at $LOCK"
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || fail "another swap is running (lock $LOCK)"
  else
    fail "another swap is running (lock $LOCK)"
  fi
fi
cleanup() {
  if [ -n "${DS_BOT_SWAP_JOB:-}" ]; then
    launchctl remove "$DS_BOT_SWAP_JOB" >/dev/null 2>&1 || true
  fi
  rmdir "$LOCK" 2>/dev/null
}
trap cleanup EXIT

# --- restart-loop guard ---------------------------------------------------------
NOW=$(date +%s)
touch "$HISTORY"
if [ "$FORCE" -eq 0 ]; then
  RECENT=$(awk -F'\t' -v now="$NOW" -v src="$NEW" '$1 >= now-600 && $2 == src' "$HISTORY" | wc -l | tr -d ' ')
  if [ "${RECENT:-0}" -ge 3 ]; then
    say "ABORT: $NEW was swapped $RECENT times in the last 10 minutes; that looks like a restart loop."
    say "ABORT: re-run with --force if it is really intended."
    exit 2
  fi
fi
printf '%s\t%s\n' "$NOW" "$NEW" >>"$HISTORY"
awk -F'\t' -v now="$NOW" '$1 >= now-600' "$HISTORY" >"$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY"

# --- quit the running app -------------------------------------------------------
# Only the copy at $TARGET is quit: a swap into another folder (a test target, a second
# install) must not take down the app the user is running from /Applications.
running_from_target() { pgrep -f "$TARGET/Contents/MacOS/DS Bot" >/dev/null; }
if running_from_target; then
  say "swap: quitting the running app"
  osascript -e 'quit app "DS Bot"' >>"$LOG" 2>&1 || true
  for _ in $(seq 1 40); do
    running_from_target || break
    sleep 0.5
  done
  pkill -f "$TARGET/Contents/MacOS/DS Bot" 2>/dev/null || true
  pkill -f "$TARGET/Contents/Frameworks/DS Bot Helper" 2>/dev/null || true
  sleep 2
  if running_from_target; then
    fail "the app did not quit"
  fi
else
  say "swap: nothing runs from $TARGET; not quitting anything"
fi

# --- move the old aside, install the new, and check the copy --------------------
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="$TARGET.bak-$TS"
say "swap: old app -> $BACKUP"
mv "$TARGET" "$BACKUP" || fail "could not move the old app aside"
if ! ditto "$NEW" "$TARGET" 2>>"$LOG"; then
  say "swap: copying the new app failed; putting the old one back"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  [ "${DS_BOT_SWAP_OPEN:-1}" = "1" ] && open "$TARGET" >/dev/null 2>&1 || true
  fail "copying the new app failed; the old app was restored"
fi
if ! codesign --verify --deep --strict "$TARGET" 2>>"$LOG" || [ ! -x "$(executable_of "$TARGET")" ]; then
  say "swap: the installed copy does not verify; rolling back"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  [ "${DS_BOT_SWAP_OPEN:-1}" = "1" ] && open "$TARGET" >/dev/null 2>&1 || true
  fail "the installed copy failed verification; the old app was restored"
fi
say "swap: installed $(version_of "$TARGET") at $TARGET (signature $(codesign -dv --verbose=4 "$TARGET" 2>&1 | sed -n 's/^Authority=//p' | head -1))"

# Keep the newest backups only.
ls -1d "$TARGET".bak-* 2>/dev/null | sort -r | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
  say "swap: dropping old backup $old"
  rm -rf "$old"
done

if [ "${DS_BOT_SWAP_OPEN:-1}" = "1" ]; then
  open "$TARGET" >/dev/null 2>&1 || say "swap: warning: could not open $TARGET"
fi
say "swap: done"
printf 'swap-app: installed %s (%s)\n' "$TARGET" "$(version_of "$TARGET")"
