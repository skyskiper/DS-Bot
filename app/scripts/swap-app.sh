#!/bin/bash
# Replace the installed DS Bot app with a freshly packed one, in two steps.
#
#   app/scripts/swap-app.sh --stage <new .app>     plan only; changes nothing
#   app/scripts/swap-app.sh --install <new .app>   swap, after the user said yes
#   app/scripts/swap-app.sh --tidy                 delete what an earlier swap could not
#
# Nothing is ever replaced without --install: a bare `swap-app.sh <app>` refuses, so a
# swap cannot happen by accident. `--check` is the older name for `--stage`.
#
# Run --install DETACHED from the app it replaces: schedule it with launchd, never as a
# child of the app (a child is killed with the app):
#
#   launchctl submit -l ds-bot-swap -- /bin/bash -c \
#     'sleep 3; DS_BOT_SWAP_JOB=ds-bot-swap /path/to/app/scripts/swap-app.sh --install "/path/to/DS Bot.app"'
#
# `DS_BOT_SWAP_JOB` names that launchd job, so the script can take it down when it ends
# as the job's own process. A wrapper that scheduled the job keeps it: this script only
# removes a job whose running process is itself, so steps after it still run.
#
# How it stays safe:
#   * --stage verifies the new bundle, says what will move where, and touches nothing
#     (it neither signs, writes a log, nor takes the lock);
#   * the old app exists only inside the swap window, under ~/Library/Caches/ds-bot-swap/
#     (LaunchServices does not scan that folder as apps), and is deleted as soon as the
#     new app verifies; a failed swap puts it back;
#   * a delete that fails is written to ~/.ds-bot/swap-pending.json, and --tidy deletes
#     exactly those paths once they are free; running --tidy twice is harmless;
#   * the new app is signed with this machine's Apple Development identity before it
#     lands (app/scripts/sign-app.sh), because the privacy grants follow that identity;
#   * the old bundle is unregistered from LaunchServices before the move and the new one
#     registered after it, so the open dialog does not collect stale entries;
#   * one swap at a time (lock directory, stale after 15 minutes); a 4th swap of the same
#     bundle within ten minutes is refused as a restart loop (--force skips that);
#   * every install and tidy step lands in /tmp/ds-bot-swap.log.
#
# Environment: DS_BOT_SWAP_TARGET (installed app), DS_BOT_SWAP_TMP (swap cache),
# DS_BOT_SWAP_PENDING, DS_BOT_SWAP_LOG, DS_BOT_SWAP_LOCK, DS_BOT_SWAP_HISTORY,
# DS_BOT_SWAP_OPEN=0 (leave the installed app closed), DS_BOT_REQUIRE_SIGN=1 (no
# identity is an error; see sign-app.sh), DS_BOT_SWAP_RM (the command used to delete a
# backup, for the test that checks the pending list).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# This machine's settings, ignored by git: swap-app.local.sh (see its .example).
[ -f "$HERE/swap-app.local.sh" ] && . "$HERE/swap-app.local.sh"

TARGET="${DS_BOT_SWAP_TARGET:-/Applications/DS Bot.app}"
TMP="${DS_BOT_SWAP_TMP:-$HOME/Library/Caches/ds-bot-swap}"
PENDING="${DS_BOT_SWAP_PENDING:-$HOME/.ds-bot/swap-pending.json}"
LOG="${DS_BOT_SWAP_LOG:-/tmp/ds-bot-swap.log}"
LOCK="${DS_BOT_SWAP_LOCK:-/tmp/ds-bot-swap.lock}"
HISTORY="${DS_BOT_SWAP_HISTORY:-/tmp/ds-bot-swap.history}"
OPEN="${DS_BOT_SWAP_OPEN:-1}"
RM="${DS_BOT_SWAP_RM:-rm}"

MODE=""
NEW=""
FORCE=0
usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
}
for arg in "$@"; do
  case "$arg" in
    --stage|--check) MODE=stage ;;
    --install) MODE=install ;;
    --tidy) MODE=tidy ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    -*)
      printf 'swap-app: unknown option %s\n' "$arg" >&2
      exit 2
      ;;
    *) NEW="$arg" ;;
  esac
done
if [ -z "$MODE" ]; then
  printf 'swap-app: say --stage, --install or --tidy; nothing is replaced without --install\n' >&2
  usage >&2
  exit 2
fi
if [ "$MODE" = "tidy" ]; then
  [ -z "$NEW" ] || { printf 'swap-app: --tidy takes no app\n' >&2; exit 2; }
else
  [ -n "$NEW" ] || { printf 'swap-app: %s needs the new .app\n' "--$MODE" >&2; exit 2; }
fi

say() {
  # --stage touches nothing, a log file included.
  [ "$MODE" = "stage" ] && return 0
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}
fail() { say "ABORT: $*"; printf 'swap-app: %s\n' "$*" >&2; exit 1; }
version_of() { /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist" 2>/dev/null; }
executable_of() {
  local name
  name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$1/Contents/Info.plist" 2>/dev/null)
  printf '%s/Contents/MacOS/%s' "$1" "${name:-DS Bot}"
}
authority_of() { codesign -dv --verbose=4 "$1" 2>&1 | sed -n 's/^Authority=//p' | head -1; }
lsregister() {
  local tool=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [ -x "$tool" ] || return 0
  "$tool" "$@" >/dev/null 2>&1 || say "swap: lsregister $* reported a problem (ignored)"
}
# Any process launched from the bundle means the app is up: its helpers live under
# $TARGET/Contents/Frameworks, and a sandbox can hide the main process from pgrep.
running_from_target() { pgrep -f "$TARGET/" >/dev/null 2>&1; }

# The new bundle, before anything is touched.
check_bundle() {
  [ -d "$NEW" ] || fail "new app is missing: $NEW"
  local exe
  exe=$(executable_of "$NEW")
  [ -x "$exe" ] || fail "new app has no executable at $exe"
  local sig
  if ! sig=$(codesign -v "$NEW" 2>&1); then
    fail "new app does not pass codesign -v: $NEW"
  fi
  local ver
  ver=$(version_of "$NEW")
  [ -n "$ver" ] || fail "new app has no CFBundleShortVersionString"
  printf '%s' "$ver"
}

# The path lists a failed delete left behind, one per line.
pending_paths() {
  [ -f "$PENDING" ] || return 0
  local count index
  count=$(plutil -extract paths raw -o - "$PENDING" 2>/dev/null) || return 0
  case "$count" in ''|*[!0-9]*) return 0 ;; esac
  for ((index = 0; index < count; index += 1)); do
    plutil -extract "paths.$index" raw -o - "$PENDING" 2>/dev/null
  done
}

write_pending() {
  # Paths arrive one per line on stdin: a path with spaces is still one path.
  local dir tmp first=1 path
  dir=$(dirname "$PENDING")
  mkdir -p "$dir" || { say "swap: cannot create $dir; the pending list is lost"; return 1; }
  tmp="$PENDING.$$"
  {
    printf '{\n  "version": 1,\n  "paths": ['
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      [ "$first" -eq 1 ] || printf ','
      printf '\n    "%s"' "$(printf '%s' "$path" | sed 's/\\/\\\\/g; s/"/\\"/g')"
      first=0
    done
    [ "$first" -eq 1 ] || printf '\n  '
    printf ']\n}\n'
  } >"$tmp" && mv "$tmp" "$PENDING" || { say "swap: cannot write $PENDING"; return 1; }
}

# Record what could not be deleted, with anything already listed.
record_pending() {
  { pending_paths; printf '%s\n' "$@"; } | sed '/^$/d' | awk '!seen[$0]++' | write_pending
}

# --- stage: the plan, and nothing else ------------------------------------------
stage() {
  local ver sig identity
  ver=$(check_bundle)
  sig=$(authority_of "$NEW")
  identity=$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development: .*\)".*/\1/p' | head -1)
  printf 'new app:   %s (version %s)\n' "$NEW" "$ver"
  printf 'signature: %s\n' "${sig:-ad hoc}"
  if [ -x "$HERE/sign-app.sh" ]; then
    if [ -n "$identity" ]; then
      printf 'signing:   will sign with %s before installing\n' "$identity"
    else
      printf 'signing:   no Apple Development identity; the app stays ad hoc and the grants follow the old identity\n'
    fi
  else
    printf 'signing:   app/scripts/sign-app.sh is missing; the app goes in as it was signed\n'
  fi
  if [ -d "$TARGET" ]; then
    if running_from_target; then
      printf 'target:    %s (running; the swap quits it)\n' "$TARGET"
    else
      printf 'target:    %s (nothing running from it)\n' "$TARGET"
    fi
  else
    printf 'target:    %s (missing; the swap stops)\n' "$TARGET"
  fi
  printf 'backup:    %s/DS Bot.app.bak-<timestamp>, deleted once the new app verifies\n' "$TMP"
  printf 'pending:   %s, listed only when that delete fails\n' "$PENDING"
  printf 'steps:     quit the target app → lsregister -u → move old to the cache → copy new →\n'
  printf '           codesign --verify --deep --strict → lsregister -f → delete the backup\n'
  printf '\nnothing was changed; run --install to swap\n'
}

# --- install: the swap itself ----------------------------------------------------
rollback() {
  say "swap: $1; putting the old app back"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET" || say "swap: could not put the old app back from $BACKUP"
  lsregister -f "$TARGET"
  [ "$OPEN" = "1" ] && open "$TARGET" >/dev/null 2>&1
  fail "$1; the old app was restored"
}

install() {
  local ver sig backup
  ver=$(check_bundle)
  if [ -x "$HERE/sign-app.sh" ]; then
    say "swap: signing the new app"
    local out
    if ! out=$("$HERE/sign-app.sh" "$NEW" 2>&1); then
      printf '%s\n' "$out" >>"$LOG"
      fail "could not sign the new app: $NEW"
    fi
    printf '%s\n' "$out" | while IFS= read -r line; do say "swap: $line"; done
  fi
  sig=$(authority_of "$NEW")
  say "swap: new=$NEW version=$ver signature=${sig:-ad hoc} target=$TARGET pid=$$ parent=$(ps -o command= -p "$PPID" 2>/dev/null | cut -c1-120)"
  [ -d "$TARGET" ] || fail "the installed app is missing: $TARGET"

  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
      say "swap: clearing a stale lock at $LOCK"
      rmdir "$LOCK" 2>/dev/null
      mkdir "$LOCK" 2>/dev/null || fail "another swap is running (lock $LOCK)"
    else
      fail "another swap is running (lock $LOCK)"
    fi
  fi
  # A launchd job started directly holds this script as its process, and removing it at
  # the end is how that one-shot job goes away. A wrapper holds the job instead; removing
  # it there would kill the wrapper and every step after this script.
  job_pid() {
    [ -n "${DS_BOT_SWAP_JOB:-}" ] || return 0
    launchctl list 2>/dev/null | awk -v name="$DS_BOT_SWAP_JOB" '$3 == name { print $1; exit }'
  }
  release_job() {
    [ -n "${DS_BOT_SWAP_JOB:-}" ] || return 0
    local pid
    pid=$(job_pid)
    if [ "$pid" = "$$" ]; then
      launchctl remove "$DS_BOT_SWAP_JOB" >/dev/null 2>&1 || true
    else
      say "swap: job $DS_BOT_SWAP_JOB belongs to another process (pid ${pid:-not listed}); not removing it"
    fi
  }
  cleanup() {
    release_job
    rmdir "$LOCK" 2>/dev/null
  }
  trap cleanup EXIT

  local now recent
  now=$(date +%s)
  touch "$HISTORY"
  if [ "$FORCE" -eq 0 ]; then
    recent=$(awk -F'\t' -v at="$now" -v src="$NEW" '$1 >= at-600 && $2 == src' "$HISTORY" | wc -l | tr -d ' ')
    if [ "${recent:-0}" -ge 3 ]; then
      say "ABORT: $NEW was swapped $recent times in the last 10 minutes; that looks like a restart loop."
      say "ABORT: re-run with --force if it is really intended."
      exit 2
    fi
  fi
  printf '%s\t%s\n' "$now" "$NEW" >>"$HISTORY"
  awk -F'\t' -v at="$now" '$1 >= at-600' "$HISTORY" >"$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY"

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
    running_from_target && fail "the app did not quit"
  else
    say "swap: nothing runs from $TARGET; not quitting anything"
  fi

  mkdir -p "$TMP" || fail "could not create the swap cache: $TMP"
  backup="$TMP/DS Bot.app.bak-$(date +%Y%m%d-%H%M%S)"
  lsregister -u "$TARGET"
  say "swap: old app -> $backup"
  mv "$TARGET" "$backup" || fail "could not move the old app aside"
  ditto "$NEW" "$TARGET" 2>>"$LOG" || rollback "copying the new app failed"
  if ! codesign --verify --deep --strict "$TARGET" 2>>"$LOG" || [ ! -x "$(executable_of "$TARGET")" ]; then
    rollback "the installed copy failed verification"
  fi
  lsregister -f "$TARGET"
  say "swap: installed $(version_of "$TARGET") at $TARGET (signature $(authority_of "$TARGET"))"

  local kept=""
  if ! "$RM" -rf "$backup" 2>>"$LOG"; then
    kept="$backup"
    say "swap: could not delete $backup; it is on the pending list"
  fi
  # A swap that died before this point leaves its own backup in the cache.
  local stray
  for stray in "$TMP"/DS\ Bot.app.bak-*; do
    [ -e "$stray" ] || continue
    [ "$stray" = "$kept" ] && continue
    "$RM" -rf "$stray" 2>>"$LOG" || kept="${kept:+$kept
}$stray"
  done
  [ -z "$kept" ] || record_pending "$kept"

  [ "$OPEN" = "1" ] && { open "$TARGET" >/dev/null 2>&1 || say "swap: warning: could not open $TARGET"; }
  say "swap: done"
  printf 'swap-app: installed %s (%s, %s)\n' "$TARGET" "$(version_of "$TARGET")" "$(authority_of "$TARGET")"
  if [ -n "$kept" ]; then
    printf 'swap-app: could not delete %s — run --tidy once it is free\n' "$kept"
  fi
}

# --- tidy: only what a failed delete listed --------------------------------------
tidy() {
  local kept="" path count
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then
      say "tidy: already gone: $path"
      continue
    fi
    if "$RM" -rf "$path" 2>>"$LOG"; then
      say "tidy: deleted $path"
    else
      say "tidy: still cannot delete $path"
      kept="${kept:+$kept
}$path"
    fi
  done <<<"$(pending_paths)"
  printf '%s\n' "$kept" | sed '/^$/d' | write_pending
  count=$(printf '%s\n' "$kept" | sed '/^$/d' | wc -l | tr -d ' ')
  say "tidy: done, $count path(s) still pending"
  local apps
  apps=$(find /Applications -maxdepth 1 -name 'DS Bot*.app' -print 2>/dev/null)
  if [ -z "$apps" ]; then
    printf 'swap-app: no DS Bot app in /Applications\n'
    return 1
  fi
  count=$(printf '%s\n' "$apps" | wc -l | tr -d ' ')
  printf 'swap-app: /Applications holds %s DS Bot app(s):\n' "$count"
  printf '%s\n' "$apps" | sed 's/^/  /'
  [ "$count" -le 1 ]
}

case "$MODE" in
  stage) stage ;;
  install) install ;;
  tidy) tidy ;;
esac
