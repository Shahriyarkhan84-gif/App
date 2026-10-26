// After `expo export -p web`: put the marketing website (site/) in front of the app.
// - dist/index.html (the app) becomes dist/app.html, which vercel.json serves for every address
//   the website doesn't own; dist/404.html is the same app for Cloudflare Pages, which has no
//   catch-all rewrite.
// - Each site/pages/<name>.html is wrapped in site/layout.html and written to dist/index.html
//   (home) or dist/<name>/index.html, so /download, /creators, ... are plain static pages.
//   A page starts with front matter (title, description, path, nav) and may hold
//   <!-- head -->…<!-- /head --> and <!-- scripts -->…<!-- /scripts --> blocks.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { iosProfile } from './ios-profile.mjs';

const dist = new URL('../dist/', import.meta.url);
const site = new URL('../site/', import.meta.url);
const at = (f) => new URL(f, dist);

if (!existsSync(at('index.html'))) throw new Error('dist/index.html missing: run expo export first');
renameSync(at('index.html'), at('app.html'));
copyFileSync(at('app.html'), at('404.html'));
copyFileSync(new URL('site.css', site), at('site.css'));

const layout = readFileSync(new URL('layout.html', site), 'utf8');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const block = (body, name) => {
  const m = body.match(new RegExp(`<!-- ${name} -->([\\s\\S]*?)<!-- /${name} -->\\n?`));
  return m ? [m[1].trim(), body.replace(m[0], '')] : ['', body];
};

const pages = readdirSync(new URL('pages/', site))
  .filter((f) => f.endsWith('.html'))
  .map((file) => {
    const raw = readFileSync(new URL(`pages/${file}`, site), 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fm) throw new Error(`site/pages/${file}: missing front matter`);
    const meta = Object.fromEntries(fm[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
    for (const key of ['title', 'description', 'path', 'nav']) if (!meta[key]) throw new Error(`site/pages/${file}: missing ${key}`);
    let body = raw.slice(fm[0].length);
    let head, scripts;
    [head, body] = block(body, 'head');
    [scripts, body] = block(body, 'scripts');
    return { ...meta, head, scripts, main: body.trim() };
  });

// Header order: Home is the wordmark, the rest are links.
const ORDER = ['Download', 'Creators', 'Agencies', 'Safety', 'About'];
const linked = ORDER.map((n) => pages.find((p) => p.nav === n)).filter(Boolean);

for (const page of pages) {
  const current = (p) => (p.path === page.path ? ' aria-current="page"' : '');
  const nav = linked.map((p) => `<a class="link" href="${p.path}"${current(p)}>${p.nav}</a>`).join('\n      ');
  const menu = [{ path: '/', nav: 'Home' }, ...linked].map((p) => `<li><a href="${p.path}"${current(p)}>${p.nav}</a></li>`).join('');
  const values = { title: escape(page.title), description: escape(page.description), path: page.path, head: page.head, scripts: page.scripts, nav, menu, main: page.main };
  const html = layout.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in values)) throw new Error(`site/layout.html: unknown {{${k}}}`);
    return values[k];
  });
  const out = page.path === '/' ? 'index.html' : `${page.path.slice(1)}/index.html`;
  if (out !== 'index.html') mkdirSync(at(page.path.slice(1)), { recursive: true });
  writeFileSync(at(out), html);
}

// iPhone install profile (Settings → Install on iPhone), for the brand being built.
const brandDir = new URL(`../brands/${process.env.BRAND || 'zynalive'}/`, import.meta.url);
const brand = JSON.parse(readFileSync(new URL('brand.json', brandDir), 'utf8'));
const icon = readFileSync(new URL(brand.assets.icon.replace(/^\.\//, '../../'), brandDir));
writeFileSync(at('ios.mobileconfig'), iosProfile(brand, icon));

console.log(`Website: ${pages.map((p) => p.path).join(', ')}. App at every other path (dist/app.html, dist/404.html). iPhone profile: /ios.mobileconfig.`);
