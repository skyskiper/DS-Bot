#!/bin/bash
# Look for values that belong to this machine alone: tokens, private keys, personal
# email addresses and certificate files. It reads the machine-private scripts
# (*.local.sh, *.local.env) and everything staged for the next commit, so a local value
# cannot ride into a commit by accident.
#
#   dev/check-secrets.sh
#
# Exit 0 and "0 findings" when nothing was found; exit 1 and one line per finding
# otherwise. Placeholders such as <account> or /path/to/... are fine; a real value is not.
set -u

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO" || exit 1

# A token, a private key block, or an email address inside a file.
CONTENT='token=[A-Za-z0-9_-]{12,}|BEGIN [A-Z ]*PRIVATE KEY|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
# A certificate or key file on its way into the repository.
CERT='\.(p12|pem|key|cer|crt|pfx)$'

OUT=$(mktemp) || exit 1
trap 'rm -f "$OUT"' EXIT

# 1. The machine-private scripts on disk, ignored by git but still this machine's.
while IFS= read -r -d '' file; do
  grep -nE "$CONTENT" "$file" 2>/dev/null | sed "s|^|${file#./}:|" >>"$OUT"
done < <(find . -type f \( -name '*.local.sh' -o -name '*.local.env' \) \
  -not -path './node_modules/*' -not -path './.git/*' -print0)

# 2. Everything staged for the next commit: its content, and any certificate's name.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  if printf '%s' "$file" | grep -qE "$CERT"; then
    printf '%s: a certificate file must not be committed\n' "$file" >>"$OUT"
    continue
  fi
  git show ":$file" 2>/dev/null | grep -nE "$CONTENT" | sed "s|^|$file:|" >>"$OUT"
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [ -s "$OUT" ]; then
  printf 'check-secrets: %s finding(s):\n' "$(wc -l <"$OUT" | tr -d ' ')"
  sed 's/^/  /' "$OUT"
  exit 1
fi
printf 'check-secrets: 0 findings\n'
