// Build the game as a static page that can be published as a claude.ai artifact.
// - Vite build with a relative base (`./`), so every asset URL is relative to the page.
// - `page.html`: the page content without the document skeleton (the artifact host adds doctype/head/body):
//   title, styles, preload/script tags and the body markup of index.html.
// - `files.json`: the list of published files ({path} relative to the output folder), for the Artifact tool.
// Usage: node tools/build-artifact.mjs [outDir=dist-artifact]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'dist-artifact');
execSync(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`, { stdio: 'inherit' });

const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
// Keep the tags the page needs; the host skeleton already provides charset + viewport metas.
const tags = head.match(/<(title|style)[\s\S]*?<\/\1>|<link\b[^>]*>|<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
fs.writeFileSync(path.join(out, 'page.html'), `${tags.join('\n')}\n${body.trim()}\n`);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = path.relative(out, p).split(path.sep).join('/');
      if (!['index.html', 'page.html', 'files.json'].includes(rel)) files.push({ path: rel });
    }
  }
};
walk(out);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files));
const bytes = files.reduce((a, f) => a + fs.statSync(path.join(out, f.path)).size, 0);
console.log(`artifact page: ${path.join(out, 'page.html')} + ${files.length} files (${(bytes / 1e6).toFixed(1)} MB)`);
