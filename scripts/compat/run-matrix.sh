#!/bin/bash
# Runs probe.cjs in the browsers bundled with several Playwright releases (old release = old browser build).
# Needs the demo built (pnpm build:demo) and served on 127.0.0.1:4173 (python3 -m http.server 4173 -d demo-dist --bind 127.0.0.1).
# Usage: run-matrix.sh <outdir> <playwright version>...
OUT=$1; shift
WORK=${COMPAT_WORK:-/tmp/compat-work}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT" "$WORK"
for V in "$@"; do
  D="$WORK/pw-$V"; B="$WORK/browsers-$V"
  mkdir -p "$D"
  (cd "$D" && [ -d node_modules/playwright-core ] || (npm init -y >/dev/null 2>&1; npm i "playwright-core@$V" --no-audit --no-fund >/dev/null 2>&1)) || { echo "$V: npm install failed"; continue; }
  for BR in ${BROWSERS:-chromium firefox webkit}; do
    export PLAYWRIGHT_BROWSERS_PATH="$B"
    if ! (cd "$D" && "./node_modules/.bin/$(ls node_modules/.bin | grep -m1 playwright)" install $BR >"$WORK/install-$V-$BR.log" 2>&1); then echo "$V $BR: download failed ($(tail -1 "$WORK/install-$V-$BR.log"))"; continue; fi
    perl -e "alarm ${ALARM:-120}; exec @ARGV" node "$HERE/probe.cjs" "$D/node_modules/playwright-core" $BR "$OUT/pw$V-$BR.json" || echo "$V $BR: probe crashed"
  done
  rm -rf "$B"
done
