#!/bin/bash
# Sign a DS Bot app copy with this machine's Apple Development identity, so the TCC grants
# (Screen Recording, Accessibility) survive the next rebuild: they follow the signing
# identity, and an ad-hoc signature changes its cdhash on every build.
#
#   app/scripts/sign-app.sh <new .app>          sign in place, then verify strictly
#   app/scripts/sign-app.sh --check <new .app>  verify only; change nothing
#
# The shared script at ~/githubProjects/decision-graph/scripts/sign-dsbot.sh signs the
# same way; it is used when it is executable (DS_BOT_SIGN_SCRIPT names another path).
# Without an Apple Development identity the app stays ad-hoc and this says so: set
# DS_BOT_REQUIRE_SIGN=1 where an unsigned app is worse than no swap at all.
set -u

CHECK=0
APP=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) printf 'sign-app: unknown option %s\n' "$arg" >&2; exit 2 ;;
    *) APP="$arg" ;;
  esac
done
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  printf 'sign-app: not an app bundle: %s\n' "${APP:-<none>}" >&2
  exit 2
fi

authority() { codesign -dv --verbose=4 "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1; }
verify() { codesign --verify --deep --strict "$APP" 2>&1; }

if [ "$CHECK" -eq 1 ]; then
  verify || { printf 'sign-app: %s does not verify\n' "$APP" >&2; exit 1; }
  printf 'sign-app: %s verifies — %s\n' "$(basename "$APP")" "$(authority)"
  exit 0
fi

SHARED="${DS_BOT_SIGN_SCRIPT:-$HOME/githubProjects/decision-graph/scripts/sign-dsbot.sh}"
if [ -x "$SHARED" ]; then
  if APP="$APP" "$SHARED"; then
    exit 0
  fi
  printf 'sign-app: %s failed; signing here instead\n' "$SHARED" >&2
fi

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development: .*\)".*/\1/p' | head -1)
if [ -z "$IDENTITY" ]; then
  if [ "${DS_BOT_REQUIRE_SIGN:-0}" = "1" ]; then
    printf 'sign-app: no Apple Development identity, and DS_BOT_REQUIRE_SIGN=1\n' >&2
    exit 1
  fi
  printf 'sign-app: no Apple Development identity; %s stays ad-hoc (TCC grants follow the old one)\n' "$APP" >&2
  exit 0
fi

printf 'sign-app: signing with %s\n' "$IDENTITY"
codesign --force --deep --sign "$IDENTITY" "$APP" || exit 1
verify || { printf 'sign-app: %s did not verify after signing\n' "$APP" >&2; exit 1; }
printf 'sign-app: signed — %s\n' "$(authority)"
