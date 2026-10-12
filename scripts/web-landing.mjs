// After `expo export -p web`: make the public website the page at "/" and keep the app for every
// other address. dist/index.html (the app) becomes dist/app.html, which vercel.json serves for all
// other paths; dist/404.html is the same app for Cloudflare Pages, which has no catch-all rewrite.
import { copyFileSync, existsSync, renameSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const at = (f) => new URL(f, dist);
if (!existsSync(at('landing.html'))) throw new Error('dist/landing.html missing: is public/landing.html still there?');
renameSync(at('index.html'), at('app.html'));
renameSync(at('landing.html'), at('index.html'));
copyFileSync(at('app.html'), at('404.html'));
console.log('Website at /, app at every other path (dist/app.html, dist/404.html).');
