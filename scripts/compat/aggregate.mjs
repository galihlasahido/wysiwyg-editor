// Reads the probe results (one JSON file per browser build) and writes scripts/compat/results.json, which scripts/gen-landing.py turns into the table on the demo site.
// Usage: node scripts/compat/aggregate.mjs <dir with results>... (later directories replace earlier ones for the same browser build)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const runs = new Map();
for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).filter((x) => /^pw.*\.json$/.test(x))) {
    const o = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (o.fatal || !o.version) continue;                                   // the browser would not start on this machine: nothing to say about the library
    const major = parseInt(o.version, 10);
    const failed = o.steps.filter((s) => !s.ok).map((s) => ({ name: s.name, note: s.note }));
    runs.set(`${o.browser}-${major}`, {
      browser: o.browser, version: o.version, major, total: o.steps.length, passed: o.steps.length - failed.length, failed,
      retried: o.steps.filter((s) => s.ok && /second try/.test(s.note)).map((s) => s.name),
      features: o.features,
    });
  }
}
const list = [...runs.values()].sort((a, b) => a.browser.localeCompare(b.browser) || a.major - b.major);
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), runs: list }, null, 1) + '\n');
for (const r of list) console.log(r.browser.padEnd(9), String(r.version).padEnd(14), `${r.passed}/${r.total}`, r.failed.map((f) => f.name).join('; '));
