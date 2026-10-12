# Browser compatibility runs

`probe.cjs` opens the built demo site in one browser and runs 34 checks (every demo page loads without an error, typing, undo, bold,
paged layout, data table search / sort / edit / export / themes / highlights / bars, the stand-alone table). `run-matrix.sh` runs it in
the browsers that ship with old Playwright releases (an old release is an old browser build); `aggregate.mjs` writes `results.json`,
which `scripts/gen-landing.py` turns into the "Browser support" section of the demo site.

```bash
pnpm build:demo
python3 -m http.server 4173 -d demo-dist --bind 127.0.0.1 &
BROWSERS="chromium firefox" scripts/compat/run-matrix.sh /tmp/compat 1.14.1 1.26.1 1.35.1 1.44.1 1.52.0 1.56.1
BROWSERS="webkit"           scripts/compat/run-matrix.sh /tmp/compat 1.30.0 1.40.1 1.52.0 1.56.1
node scripts/compat/aggregate.mjs /tmp/compat && python3 scripts/gen-landing.py
```

Limits: each release downloads its browsers (a few hundred MB, removed afterwards); builds older than Chromium 94 need Rosetta on Apple
Silicon and WebKit older than 16.4 does not start on current macOS, so nothing below those was run. The playwright-core packages are
installed in a scratch folder, not in this project.
