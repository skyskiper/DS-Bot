# Self-hosting this fork

This repository is maintained for one user's own use. `origin` is the fork
(`skyskiper/DS-Bot`), `upstream` is the upstream project (`Fei2411/DS-Bot`).
Push to `origin`; pull from `upstream`.

## Two checkouts

Keep the work in progress and the copy the app runs apart:

- `~/DS Bot/DS-Bot-dev` — development. Any branch, any build.
- `~/DS Bot/DS-Bot-stable` — what the app links to. Only merged, checked code.

Both are checkouts of the same repository; `stable` can be a git worktree of
`main`. The app resolves its plugin from `~/.ds-bot/profiles/ds-bot/package.json`,
which holds one dependency, `"ds-bot": "link:<checkout>/ds-bot"`.
`ds-bot/dev/self-host.sh` edits that line and runs the app's pnpm; restart the
app after a link change.

## The self-host script

Run from a checkout of this repository:

```sh
ds-bot/dev/self-host.sh              # build, check, lint, test, then link stable
ds-bot/dev/self-host.sh --dev        # link the development checkout
ds-bot/dev/self-host.sh --stable     # link the default stable checkout
ds-bot/dev/self-host.sh --stable DIR # link DIR (a plugin folder, not its parent)
ds-bot/dev/self-host.sh --restore    # the app's own bundled plugin again
ds-bot/dev/self-host.sh --dry-run    # print the steps, change nothing
ds-bot/dev/self-host.sh --help
```

`install` (the default) runs four steps in the checkout the script is in:
`build`, `scripts/build-client.mjs --check`, `lint`, `test`. Only when all
four pass does it point the app at `DS_BOT_STABLE` and run pnpm. Every step
stops at the first failure, and a failed link puts `package.json` back.

Paths come from the environment:

| variable | default |
| --- | --- |
| `DS_BOT_PROFILE` | `~/.ds-bot/profiles/ds-bot` |
| `DS_BOT_DEV` | `~/DS Bot/DS-Bot-dev/ds-bot` |
| `DS_BOT_STABLE` | `~/DS Bot/DS-Bot-stable/ds-bot` |
| `DS_BOT_PNPM` | the pnpm inside `DS Bot.app` |
| `SELF_HOST_TEST_BASELINE` | unset: any test failure stops install |

A worktree has no `node_modules` of its own. Run `npm ci` in its `ds-bot/`;
when its `dev/harness/node_modules` is missing the script reuses the
development checkout's harness.

### Known test failures

Some tests fail on some machines for environmental reasons (network in the
updater tests, DSH version drift, workspace paths). Compare against an
untouched main checkout instead of demanding none:

```sh
cd ~/DS\ Bot/DS-Bot-stable/ds-bot
npm test 2>&1 | grep '^✖' | sed 's/ (.*//; s/^✖ //' | sort -u > /tmp/main-failures
SELF_HOST_TEST_BASELINE=/tmp/main-failures ds-bot/dev/self-host.sh
```

`install` then stops only on failures that are not in that list.

## Syncing upstream

```sh
git fetch upstream
git switch main
git merge upstream/main
```

`ds-bot/client.js` and `ds-bot/office.js` are generated. A conflict in them is
never resolved by hand: take either side, then `npm run build` in `ds-bot/`
and commit the result. Run `node scripts/build-client.mjs --check` to confirm.

Real conflicts are `src/host/*` and `docs/plans/*`; the latter is append-only,
so keep both sides in time order.

## Version

Add a suffix to `ds-bot/package.json` so the running copy is identifiable:
`"version": "0.2.7+lq1"`. Do not edit `CHANGELOG.md`.

## Upgrading the app

The app and its engine are pinned together; updating under a linked checkout
leaves both sides broken.

1. `ds-bot/dev/self-host.sh --restore`
2. Update the app.
3. Merge `upstream/main` into the fork, run `npm run build`, fix the DSH API
   changes the new version brings.
4. Link again (`ds-bot/dev/self-host.sh`) and restart the app.

## Replacing the desktop app

`app/` packs into `app/dist-pack/mac-arm64/DS Bot.app` with `npm run pack` (run it with
Node 22: electron-builder 26 never settles under Node 26).

The app carries the plugin from `app/node_modules/ds-bot`, and a copied `node_modules`
keeps the plugin of the day it was installed. Refresh it before packing, or the app ships
an older `client.js`:

```sh
(cd ds-bot && npm pack --pack-destination /tmp)
rm -rf app/node_modules/ds-bot
mkdir app/node_modules/ds-bot && tar -xzf /tmp/ds-bot-*.tgz -C app/node_modules/ds-bot --strip-components=1
```

The `before-pack` hook stops the build when the two `client.js` files differ. On start the
app also drops its HTTP caches, so an updated `client.js` is never served from the old
build's cache.

`app/scripts/swap-app.sh` installs such a bundle over the running app, in two steps:

```sh
app/scripts/swap-app.sh --stage "app/dist-pack/mac-arm64/DS Bot.app"   # verify and print the plan

# replace it from a job that is NOT a child of the app it replaces, once the user said yes:
launchctl submit -l ds-bot-swap -- /bin/bash -c \
  'sleep 3; DS_BOT_SWAP_JOB=ds-bot-swap "/path/to/repo/app/scripts/swap-app.sh" --install "/Applications/DS Bot.app"'
```

`--stage` takes no lock, writes no log and signs nothing: it verifies the new bundle
and prints what will move where, so the swap can be shown before it happens. A bare
`swap-app.sh <app>` refuses; nothing is replaced without `--install`.

`--install` verifies the bundle (executable, version), signs it, quits only the app
running from `DS_BOT_SWAP_TARGET`, unregisters it from LaunchServices, moves it into
`~/Library/Caches/ds-bot-swap/`, copies the new one, verifies the copy with
`codesign --verify --deep --strict`, registers it again, and then deletes the copy it
moved aside. A failed step puts the old app back and reopens it; a fourth swap of one
bundle within ten minutes is refused as a restart loop (`--force` skips that check).
Everything lands in `/tmp/ds-bot-swap.log`, and `DS_BOT_SWAP_TARGET` overrides the
installed app path.

A copy that cannot be deleted at that moment is written to
`~/.ds-bot/swap-pending.json`, and `--tidy` deletes exactly those paths once they are
free; running it twice is harmless. `--tidy` also reports how many DS Bot apps
`/Applications` holds, which should be one.

The swap cache is a cache, not a backup: it holds the old app only for the swap
window, so LaunchServices never sees a second bundle with this application's
identifier.

## Signing the app

macOS keys the Screen Recording and Accessibility grants to the signing identity. An
ad-hoc build gets a new cdhash every time, so the grants are asked for again after each
rebuild; a build signed with a real certificate keeps them. The scripts expect a local
Apple Development certificate:

1. In Xcode, **Settings → Accounts** adds the Apple ID, then **Manage Certificates →
   "+" → Apple Development** (it lands in the login keychain with its WWDR
   intermediate).
2. `security find-identity -v -p codesigning` lists one
   `"Apple Development: <account> (<id>)"` line.
3. `app/scripts/sign-app.sh "/path/to/DS Bot.app"` signs and verifies it; the swap runs
   the same script before installing anything.

`sign-app.sh` reads the identity from `security find-identity` at run time; on a machine
with several, `DS_BOT_SIGN_IDENTITY` names the exact line to use. Without a valid
identity the app stays ad-hoc and the script says so on one line;
`DS_BOT_REQUIRE_SIGN=1` turns that into a failure, so nothing unsigned is installed.
After a swap, open **System Settings → Privacy & Security → Screen Recording /
Accessibility**, remove the old DS Bot rows, and add the new app again.

Certificates and private keys never enter this repository: the `.p12` export, its
password, and the keychain password stay in the keychain, and the scripts and docs name
no account, team or certificate.

## Machine-private settings

A machine may need values that must never reach the repository: this machine's signing
identity, another app path, another profile, a token. Each script reads those from a
local file that git ignores, and the repository keeps only a template:

| script | local file (ignored) | template |
| --- | --- | --- |
| `app/scripts/sign-app.sh` | `app/scripts/sign-app.local.sh` | `sign-app.local.sh.example` |
| `app/scripts/swap-app.sh` | `app/scripts/swap-app.local.sh` | `swap-app.local.sh.example` |
| `ds-bot/dev/self-host.sh` | `ds-bot/dev/self-host.local.sh` | `self-host.local.sh.example` |

On a new machine:

```sh
cp app/scripts/sign-app.local.sh.example app/scripts/sign-app.local.sh
cp app/scripts/swap-app.local.sh.example app/scripts/swap-app.local.sh
cp ds-bot/dev/self-host.local.sh.example ds-bot/dev/self-host.local.sh
# open the copies and fill in this machine's values; keep the templates as they are

git check-ignore -v app/scripts/sign-app.local.sh   # prints the rule that ignores it
git status                                          # shows no *.local.sh
```

A script sources its local file when the file exists, so no other step is needed: run
the script as usual. A local file that is not there means the defaults apply.

Before a commit, run the scan that looks for the same values in the machine-private
files and in everything staged:

```sh
ds-bot/dev/check-secrets.sh
# check-secrets: 0 findings
```

It exits non-zero, with one line per finding, when it meets a token, a private key
block, an email address, or a certificate file on its way into the commit. Placeholders
such as `<account>` or `/path/to/...` are fine.

## Notes

- While the app links the development checkout, `npm run build` rebuilds the
  client bundle the running window loads: the UI updates in place (HMR) and
  component state, such as scroll position and half-typed input, resets.
  Changes under `src/host/` still need a restart.
- The app's pnpm lives at
  `/Applications/DS Bot.app/Contents/Resources/app.asar.unpacked/node_modules/pnpm/bin/pnpm.cjs`.
  `--restore` needs it; `--dry-run` does not need anything installed.
