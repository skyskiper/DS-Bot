#!/bin/bash
# Sign a DS Bot app with this machine's Apple Development identity, so the TCC grants
# (Screen Recording, Accessibility) survive the next rebuild: they follow the signing
# identity, and an ad-hoc signature changes its cdhash on every build.
#
#   app/scripts/sign-app.sh <new .app>          sign in place, then verify strictly
#   app/scripts/sign-app.sh --check <new .app>  verify only; change nothing
#
# The identity is the first "Apple Development:" line of
# `security find-identity -v -p codesigning`, or the exact text in DS_BOT_SIGN_IDENTITY
# on a machine with several. Nothing here reads a certificate or a password: the
# one-time setup is in docs/self-host.md. Without a valid identity the app stays ad-hoc
# and this says so on one line; DS_BOT_REQUIRE_SIGN=1 makes that an error instead.
set -u

CHECK=0
APP=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

identities() { security find-identity -v -p codesigning 2>/dev/null; }
identity() {
  if [ -n "${DS_BOT_SIGN_IDENTITY:-}" ]; then
    printf '%s' "$DS_BOT_SIGN_IDENTITY"
    return 0
  fi
  identities | sed -n 's/.*"\(Apple Development: .*\)".*/\1/p' | head -1
}

IDENTITY=$(identity)
if [ -z "$IDENTITY" ] || ! identities | grep -F "\"$IDENTITY\"" >/dev/null 2>&1; then
  if [ "${DS_BOT_REQUIRE_SIGN:-0}" = "1" ]; then
    printf 'sign-app: no valid Apple Development identity%s, and DS_BOT_REQUIRE_SIGN=1\n' \
      "${DS_BOT_SIGN_IDENTITY:+ for \"$DS_BOT_SIGN_IDENTITY\"}" >&2
    exit 1
  fi
  printf 'sign-app: no valid Apple Development identity%s; %s stays ad-hoc (TCC grants follow the old one)\n' \
    "${DS_BOT_SIGN_IDENTITY:+ for \"$DS_BOT_SIGN_IDENTITY\"}" "$APP" >&2
  exit 0
fi

printf 'sign-app: signing with %s\n' "$IDENTITY"
codesign --force --deep --sign "$IDENTITY" "$APP" || exit 1
verify || { printf 'sign-app: %s did not verify after signing\n' "$APP" >&2; exit 1; }
printf 'sign-app: signed — %s\n' "$(authority)"
