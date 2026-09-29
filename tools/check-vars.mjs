// Static check of the simulation bus usage.
// Lists: S:/G:/L: variables read but never written, lights declared in the catalog but never written,
// and controls of the catalog never read by any system.
// Usage: node tools/check-vars.mjs [--module src/systems/misc] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--module') ? args[args.indexOf('--module') + 1] : null;
const verbose = args.includes('--verbose');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(path.join(root, 'src'));
const reads = new Map(); // pattern -> Set(files)
const writes = new Map();
const add = (m, k, f) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(path.relative(root, f)); };

// Matches get('S:X') getB('S:X') set('S:X', init('S:X' watch('S:X' and template literals `S:ENG${n}_N2`
const re = /\b(get|getB|has|watch|set|init)\(\s*(['"`])([CLSG]:[A-Za-z0-9_${}.\-+* ]+)\2/g;
for (const f of files) {
  if (f.includes(`${path.sep}dev${path.sep}fakePower`)) continue;
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src))) {
    const [, fn, , name] = m;
    const pat = name.replace(/\$\{[^}]+\}/g, '*');
    if (fn === 'set' || fn === 'init') add(writes, pat, f); else add(reads, pat, f);
  }
}

const toRe = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
// A template like `L:${p}_${r}` has almost no literal text: it would "match" every light and hide the ones nobody
// drives. Such generic writes are listed separately and do not count as proof that a given name is written.
const literal = (p) => p.slice(2).replace(/\*/g, '');
const isGeneric = (p) => p.includes('*') && literal(p).replace(/_/g, '').length < 3;
const writePats = [...writes.keys()].filter((p) => !isGeneric(p)).map((p) => [p, toRe(p)]);
const genericWrites = [...writes].filter(([p]) => isGeneric(p));
const isWritten = (name) => writePats.some(([p, r]) => r.test(name) || toRe(name).test(p));

// Catalog: extract declared lights & control ids by importing the compiled catalog through tsx is heavy;
// instead parse ids from the vars dump produced by the running app when available.
let catalogLights = [];
let catalogControls = [];
try {
  const { execSync } = await import('node:child_process');
  const out = execSync(`npx tsx -e "import('./src/core/catalog.ts').then(c=>{console.log(JSON.stringify({l:c.allLights(),c:c.CONTROLS.filter(d=>d.kind!=='ann').map(d=>d.id)}))})"`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(out.trim().split('\n').pop());
  catalogLights = j.l; catalogControls = j.c;
} catch (e) { console.log('(could not load catalog via tsx)'); }

const inScope = (set) => !only || [...set].some((f) => f.startsWith(only));

console.log('=== Variables READ but never WRITTEN (S:/G:/L:) ===');
let n = 0;
for (const [name, fs_] of [...reads].sort()) {
  if (name.startsWith('C:')) continue;
  if (!inScope(fs_)) continue;
  if (!isWritten(name)) { n++; console.log(`  ${name.padEnd(36)} read in ${[...fs_].join(', ')}`); }
}
if (!n) console.log('  (none)');

if (genericWrites.length) {
  console.log('\n=== Generic writes (too little literal text to check statically: verify with the whole-game test) ===');
  for (const [p, fs_] of genericWrites) console.log(`  ${p.padEnd(36)} ${[...fs_].join(', ')}`);
}

if (catalogLights.length) {
  console.log('\n=== Catalog LIGHTS never written (L:) — generic writes above not counted ===');
  const missing = catalogLights.filter((l) => !isWritten(`L:${l}`));
  console.log(missing.length ? '  ' + missing.join(' ') : '  (none)');
  console.log(`  ${catalogLights.length - missing.length}/${catalogLights.length} lights driven`);

  console.log('\n=== Catalog CONTROLS never read by code (C:) ===');
  const readNames = [...reads.keys()].filter((k) => k.startsWith('C:')).map((k) => [k, toRe(k)]);
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const unread = catalogControls.filter((id) => !readNames.some(([p, r]) => r.test(`C:${id}`)) && !src.includes(`'${id}:`) && !src.includes(`\`${id}:`));
  console.log(unread.length ? '  ' + unread.join(' ') : '  (none)');
  console.log(`  ${catalogControls.length - unread.length}/${catalogControls.length} controls used`);
}

if (verbose) {
  console.log('\n=== All written vars ===');
  for (const [k, v] of [...writes].sort()) console.log(`  ${k.padEnd(36)} ${[...v].join(', ')}`);
}
