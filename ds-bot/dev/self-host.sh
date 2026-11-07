#!/bin/sh
# Point the DS Bot app at a checkout of this plugin. Nothing changes unless the
# checkout passes the checks first (install) or the change is asked for (link).
#
# Usage:
#   dev/self-host.sh                  build, check, lint and test this checkout,
#                                     then link the app to the stable checkout
#   dev/self-host.sh --dev            link the app to the development checkout
#   dev/self-host.sh --stable [dir]   link the app to a stable checkout
#                                     (default: DS_BOT_STABLE)
#   dev/self-host.sh --restore        put the app back on its own bundled plugin
#   dev/self-host.sh --dry-run        with any of the above: print the steps only
#   dev/self-host.sh --help           this text
#
# Paths (override with the environment):
#   DS_BOT_PROFILE  the app's plugin profile  (default ~/.ds-bot/profiles/ds-bot)
#   DS_BOT_DEV      the development checkout  (default ~/DS Bot/DS-Bot-dev/ds-bot)
#   DS_BOT_STABLE   the stable checkout       (default ~/DS Bot/DS-Bot-stable/ds-bot)
#   DS_BOT_PNPM     the app's pnpm            (default: the one inside "DS Bot.app")
#
# Tests: some machines fail a few tests for environmental reasons (network,
# DSH version drift, workspace paths). Let install compare against a baseline
# of the failures on an untouched main checkout instead of demanding none:
#   (cd "$DS_BOT_DEV/../.." && git stash -u)  # or use a main worktree
#   npm test 2>&1 | grep '^✖' | sed 's/ (.*//; s/^✖ //' | sort -u > /tmp/main-failures
#   SELF_HOST_TEST_BASELINE=/tmp/main-failures dev/self-host.sh
# Without the baseline any failure stops install.
#
# Every step stops at the first failure. install changes the profile only after
# all four steps passed; a failed link puts the profile's package.json back.
set -u

PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
PROFILE=${DS_BOT_PROFILE:-"$HOME/.ds-bot/profiles/ds-bot"}
DEV=${DS_BOT_DEV:-"$HOME/DS Bot/DS-Bot-dev/ds-bot"}
STABLE=${DS_BOT_STABLE:-"$HOME/DS Bot/DS-Bot-stable/ds-bot"}
PNPM=${DS_BOT_PNPM:-"/Applications/DS Bot.app/Contents/Resources/app.asar.unpacked/node_modules/pnpm/bin/pnpm.cjs"}

usage() { sed -n '2,/^set -u$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
say() { printf '%s\n' "$*"; }
die() { printf 'self-host: %s\n' "$*" >&2; exit 1; }

MODE=install
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    install) MODE=install ;;
    --dev) MODE=dev ;;
    --stable)
      MODE=stable
      case "${2-}" in
        ''|-*) ;;
        *) STABLE=$2; shift ;;
      esac
      ;;
    --restore) MODE=restore ;;
    --dry-run) DRY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'self-host: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "node was not found in PATH; install Node.js or put it in PATH"
  fi
  NODE=$(command -v node)
}

# Runs a command in the plugin checkout. Dry run only prints it.
in_plugin() {
  if [ "$DRY" = 1 ]; then
    printf '+ (cd %s && %s)\n' "$PLUGIN" "$*"
    return 0
  fi
  ( cd "$PLUGIN" && "$@" )
}

# Writes the profile's ds-bot dependency. The rest of package.json stays as it is.
profile_dependency() {
  if [ "$DRY" = 1 ]; then
    printf '+ write %s: dependencies["ds-bot"] = %s\n' "$PROFILE/package.json" "$1"
    return 0
  fi
  "$NODE" -e '
    const fs = require("node:fs")
    const file = process.argv[1]
    const value = process.argv[2]
    const json = JSON.parse(fs.readFileSync(file, "utf8"))
    json.dependencies = json.dependencies || {}
    if (value === "{}") delete json.dependencies["ds-bot"]
    else json.dependencies["ds-bot"] = value
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n")
  ' "$PROFILE/package.json" "$1"
}

pnpm_install() {
  if [ "$DRY" = 1 ]; then
    printf '+ (cd %s && node %s install)\n' "$PROFILE" "$PNPM"
    return 0
  fi
  [ -f "$PNPM" ] || die "the app's pnpm was not found at $PNPM; set DS_BOT_PNPM"
  ( cd "$PROFILE" && "$NODE" "$PNPM" install )
}

show_link() {
  link=$(readlink "$PROFILE/node_modules/ds-bot" 2>/dev/null || true)
  if [ -z "$link" ]; then
    say "$PROFILE: ds-bot is not linked; the app uses its bundled plugin"
    return 0
  fi
  real=$(cd "$PROFILE/node_modules/ds-bot" 2>/dev/null && pwd -P || true)
  say "readlink: $link"
  say "resolves: ${real:-<missing>}"
}

link_to() {
  target=$1
  if [ "$DRY" = 1 ]; then
    say "would link $PROFILE to $target"
    [ -d "$target" ] || say "  (missing; a real run stops here)"
    [ -f "$PROFILE/package.json" ] || say "  $PROFILE/package.json is missing; a real run stops here"
    profile_dependency "link:$target"
    pnpm_install
    say "would print: ds-bot -> $target"
    return 0
  fi
  [ -d "$target" ] || die "$target is not a directory; set DS_BOT_DEV or DS_BOT_STABLE, or create the checkout"
  [ -f "$PROFILE/package.json" ] || die "no plugin profile at $PROFILE; set DS_BOT_PROFILE"
  backup=$(mktemp) || die "mktemp failed"
  cp "$PROFILE/package.json" "$backup"
  profile_dependency "link:$target"
  if ! pnpm_install; then
    cp "$backup" "$PROFILE/package.json"
    rm -f "$backup"
    die "pnpm install failed; $PROFILE/package.json was put back, the link is unchanged"
  fi
  rm -f "$backup"
  show_link
}

restore() {
  [ -f "$PROFILE/package.json" ] || die "no plugin profile at $PROFILE; set DS_BOT_PROFILE"
  say "restore: $PROFILE uses the plugin bundled in the app"
  profile_dependency "{}"
  if [ "$DRY" = 1 ]; then
    printf '+ rm -rf %s/node_modules %s/pnpm-lock.yaml\n' "$PROFILE" "$PROFILE"
  else
    rm -rf "$PROFILE/node_modules" "$PROFILE/pnpm-lock.yaml"
  fi
  pnpm_install || die "pnpm install failed; the profile has no dependencies now, run the app's installer again"
  if [ "$DRY" = 1 ]; then
    say "would print: ds-bot is not linked; the app uses its bundled plugin"
  else
    show_link
  fi
}

run_tests() {
  log=$(mktemp) || die "mktemp failed"
  step "test"
  if [ "$DRY" = 1 ]; then
    printf '+ (cd %s && %s --import ./test/harness-resolve.mjs --test "test/*.test.js")\n' "$PLUGIN" "$NODE"
    rm -f "$log"
    return 0
  fi
  if in_plugin "$NODE" --import ./test/harness-resolve.mjs --test 'test/*.test.js' >"$log" 2>&1; then
    say "tests: pass"
    rm -f "$log"
    return 0
  fi
  failed=$(grep '^✖ ' "$log" | sed 's/^✖ //; s/ (.*//' | grep -v '^failing tests:$' | sort -u)
  count=$(printf '%s\n' "$failed" | grep -c . || true)
  if [ -n "${SELF_HOST_TEST_BASELINE:-}" ] && [ -f "${SELF_HOST_TEST_BASELINE}" ]; then
    base=$(mktemp) || die "mktemp failed"
    list=$(mktemp) || die "mktemp failed"
    sed 's/^✖ //; s/ (.*//' "$SELF_HOST_TEST_BASELINE" | grep . | sort -u > "$base"
    printf '%s\n' "$failed" > "$list"
    fresh=$(comm -23 "$list" "$base")
    rm -f "$base" "$list"
    if [ -z "$fresh" ]; then
      say "tests: $count failures, none new against $SELF_HOST_TEST_BASELINE"
      rm -f "$log"
      return 0
    fi
    say "tests: $count failures, $(printf '%s\n' "$fresh" | grep -c .) of them new:"
    printf '%s\n' "$fresh" | sed 's/^/  /'
  else
    say "tests: $count failures:"
    printf '%s\n' "$failed" | sed 's/^/  /'
    say "compare with an untouched main checkout, then set SELF_HOST_TEST_BASELINE to let known ones through"
  fi
  rm -f "$log"
  return 1
}

step() { printf '\n== %s\n' "$1"; }

install() {
  if [ ! -d "$STABLE" ]; then
    [ "$DRY" = 1 ] || die "the stable checkout was not found at $STABLE; create it or pass --stable <dir>"
    say "stable checkout: $STABLE (missing; a real run stops here)"
  fi
  if [ ! -d "$PLUGIN/node_modules" ]; then
    [ "$DRY" = 1 ] || die "$PLUGIN/node_modules is missing; run npm ci in $PLUGIN first"
    say "node_modules: $PLUGIN/node_modules (missing; a real run stops here)"
  fi
  # A worktree has no install of its own: reuse the development checkout's harness.
  if [ ! -d "$PLUGIN/dev/harness/node_modules" ] && [ -d "$DEV/dev/harness/node_modules" ]; then
    DSH_HARNESS="$DEV/dev/harness"
    export DSH_HARNESS
    say "harness: $DSH_HARNESS"
  fi
  step "build"
  in_plugin "$NODE" scripts/build-client.mjs || die "build failed; the profile was not changed"
  step "build check"
  in_plugin "$NODE" scripts/build-client.mjs --check || die "client.js does not match src/client; run npm run build and commit it"
  step "lint"
  in_plugin "$NODE" scripts/lint.mjs || die "lint failed; the profile was not changed"
  run_tests || die "tests failed; the profile was not changed"
  step "link"
  link_to "$STABLE"
}

if [ "$DRY" = 1 ]; then
  NODE=$(command -v node 2>/dev/null || echo node)
else
  need_node
fi

case "$MODE" in
  restore) restore ;;
  dev) link_to "$DEV" ;;
  stable) link_to "$STABLE" ;;
  install) install ;;
esac
