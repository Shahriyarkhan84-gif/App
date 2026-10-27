// Store screenshots for the App Store and Google Play, drawn in the app's Glass & sky look.
// Reads the brand (name, units, features, logo), so a white-label brand gets its own set:
//   node scripts/store-screenshots.mjs [brandId]
// Writes store/screenshots/<brand>/ios (1320×2868, iPhone 6.9") and /android (1080×1920).
// The screens are illustrations of real features (sample names, no real people or photos).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brandId = process.argv[2] ?? 'zynalive';
const brand = JSON.parse(readFileSync(join(root, 'brands', brandId, 'brand.json'), 'utf8'));
const { chromium } = createRequire(import.meta.url)('playwright');

const spend = brand.units.spend[1];
const earn = brand.units.earn[1];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const font = (p) => pathToFileURL(join(root, 'node_modules/@expo-google-fonts', p)).href;
const logo = readFileSync(join(root, 'assets/logo-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
const logoUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;

const NAVY = '#0C2340';
const LIVE_RED = '#E11D48';
const GOLD = '#FFC24B';
const SKY = 'linear-gradient(180deg,#BAE6FD 0%,#E0F2FE 55%,#F0F9FF 100%)';
const NIGHT = 'linear-gradient(180deg,#0C4A6E 0%,#082F49 55%,#061826 100%)';

const avatar = (name, hue, size = 34) =>
  `<div class="av" style="width:${size}px;height:${size}px;font-size:${size * 0.42}px;background:linear-gradient(135deg,hsl(${hue} 80% 62%),hsl(${(hue + 40) % 360} 75% 45%))">${name[0]}</div>`;
// The "camera" in an illustration: a tinted mascot instead of a person.
const camera = (hue, size = 150) =>
  `<div class="cam" style="background:radial-gradient(circle at 50% 38%,hsl(${hue} 70% 55% / .55),transparent 60%),${NIGHT}"><img src="${logoUri}" style="width:${size}px;filter:hue-rotate(${hue - 200}deg) drop-shadow(0 12px 30px rgba(0,0,0,.4))"></div>`;
const hostPill = (name, hue, coins) => `
  <div class="pill">${avatar(name, hue)}<div><b>${name}</b><small>💎 ${coins}</small></div><span class="plus">+</span></div>`;
const chatLine = (who, text, color = '#67E8F9') => `<div class="chat"><b style="color:${color}">${who}</b> ${text}</div>`;

const screens = [
  {
    id: '1-live',
    title: 'Go live in one tap',
    sub: `${brand.tagline}`,
    body: `
      <div class="dark">${camera(200, 170)}
        <div class="top">${hostPill('Ayesha', 200, '12.4K')}<div class="grow"></div><div class="count">1.2K</div><div class="x">✕</div></div>
        <div class="badge-row"><span class="live">LIVE</span></div>
        <div class="bottom">
          <div class="toast"><div><b>Bilal</b><small>sent 👑 Crown</small></div><em>×5</em></div>
          ${chatLine('Sana', 'Your voice is so good 🎶')}
          ${chatLine('Hamza', 'Hello from Lahore!')}
          ${chatLine('Ayesha', 'Thank you all ❤️', GOLD)}
          <div class="bar"><div class="say">Say Hi…</div><div class="rb">☰</div><div class="rb heart">♥</div><div class="rb gift">🎁</div></div>
        </div>
      </div>`,
  },
  brand.features.pkBattles && {
    id: '2-pk',
    title: 'PK battles, live',
    sub: 'Two hosts, five minutes, every gift is a point.',
    body: `
      <div class="dark">
        <div class="top" style="position:relative;padding:14px 12px 8px">${hostPill('Zara', 330, '48.0K')}<div class="grow"></div><div class="count">3.4K</div></div>
        <div class="score"><div style="flex:62;background:linear-gradient(90deg,#0369A1,#38BDF8)">6,240</div><div style="flex:38;background:linear-gradient(90deg,#FB7185,${LIVE_RED})">3,810</div></div>
        <div class="timer">⏱ 02:41</div>
        <div class="split">${camera(330, 90)}${camera(150, 90)}</div>
        <div class="split-names"><span>Zara</span><span>Ali</span></div>
        <div class="bottom" style="position:relative;inset:auto;padding-top:10px">
          ${chatLine('Hina', 'Go Zara! 🔥')}
          ${chatLine('Usman', 'Rocket incoming 🚀')}
          <div class="toast"><div><b>Usman</b><small>sent 🚀 Rocket</small></div><em>×3</em></div>
        </div>
      </div>`,
  },
  brand.features.partyRooms && {
    id: '3-party',
    title: 'Party rooms with friends',
    sub: 'Hang out on voice or video seats. The host brings you on.',
    body: `
      <div class="dark" style="padding:16px 14px">
        <div class="top" style="position:relative;padding:0 0 14px">${hostPill('Gup Shup', 190, '8.1K')}<div class="grow"></div><div class="count">640</div></div>
        <div class="host-seat">${avatar('Mehwish', 190, 84)}<b>Mehwish · Host</b></div>
        <div class="seats">
          ${[['Ali', 20], ['Sana', 300], ['Bilal', 120], ['Zara', 330], ['', 0], ['', 0]]
            .map(([n, h], i) => `<div class="seat">${n ? avatar(n, h, 58) : '<div class="empty">+</div>'}<small>${n || `Seat ${i + 1}`}</small></div>`).join('')}
        </div>
        <div class="bottom" style="position:relative;inset:auto;padding-top:18px">
          ${chatLine('Ali', 'Next song is mine 🎤')}
          <div class="bar"><div class="say">Say something…</div><div class="rb">🎙</div><div class="rb gift">🎁</div></div>
        </div>
      </div>`,
  },
  {
    id: '4-gifts',
    title: `Send gifts. Hosts earn ${earn}.`,
    sub: `Buy ${spend} securely, gift the hosts you love.`,
    body: `
      <div class="dark">${camera(260, 120)}
        <div class="sheet">
          <div class="sheet-head"><b>Gifts</b><span>💎 1,250 <i>Recharge</i></span></div>
          <div class="gifts">
            ${[['🌹', 'Rose', 1], ['☕', 'Chai', 5], ['💖', 'Heart', 10], ['⭐', 'Star', 49], ['👑', 'Crown', 99], ['🚀', 'Rocket', 499], ['🏰', 'Palace', 999], ['🌌', 'Galaxy', 4999]]
              .map(([i, n, p], k) => `<div class="g${k === 4 ? ' on' : ''}"><span>${i}</span><small>${n}</small><em>${p.toLocaleString()}</em></div>`).join('')}
          </div>
          <div class="qty"><span class="on">×1</span><span>×10</span><span>×99</span><div class="grow"></div><div class="send">Send</div></div>
        </div>
      </div>`,
  },
  {
    id: '5-safe',
    title: 'Safe by design',
    sub: '18+ only. Verified hosts. You choose who can reach you.',
    body: `
      <div class="light">
        <div class="lhead"><img src="${logoUri}" style="width:44px"><b>Privacy & safety</b></div>
        ${[
          ['🛡️', 'Verified hosts', 'Every host passes an ID check before going live'],
          ['🎂', '18+ only', 'A birthday check keeps the app for adults'],
          ['💬', 'Who can message me', 'Everyone · People I follow · No one'],
          ['🙈', 'Hide my location', 'Your country stays off your profile'],
          ['🚫', 'Block & report', 'One tap, reviewed by our moderators'],
        ].map(([i, t, s]) => `<div class="row"><span class="ri">${i}</span><div><b>${t}</b><small>${s}</small></div><span class="ok">✓</span></div>`).join('')}
      </div>`,
  },
].filter(Boolean);

const css = (w, h) => `
@font-face{font-family:Brico;src:url(${font('bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf')})}
@font-face{font-family:DM;font-weight:400;src:url(${font('dm-sans/400Regular/DMSans_400Regular.ttf')})}
@font-face{font-family:DM;font-weight:700;src:url(${font('dm-sans/700Bold/DMSans_700Bold.ttf')})}
*{box-sizing:border-box;margin:0}
html,body{width:100%;height:100%;overflow:hidden}
body{background:${SKY};font-family:DM,'Noto Color Emoji',sans-serif;color:${NAVY};display:flex;flex-direction:column;align-items:center}
.cap{padding:${Math.min(w * 0.12, h * 0.05)}px ${w * 0.08}px ${Math.min(w * 0.06, h * 0.03)}px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:${w * 0.025}px}
.brand{display:flex;align-items:center;gap:8px;font-family:Brico;font-size:${w * 0.045}px;color:#0369A1}
.brand img{width:${w * 0.075}px}
h1{font-family:Brico;font-size:${w * 0.088}px;line-height:1.05;letter-spacing:-.5px}
.sub{font-size:${w * 0.04}px;line-height:1.35;color:#335577;max-width:90%}
.phone{flex:1;width:${w * 0.8}px;border:${w * 0.022}px solid ${NAVY};border-bottom:0;border-radius:${w * 0.11}px ${w * 0.11}px 0 0;overflow:hidden;position:relative;box-shadow:0 30px 60px rgba(12,74,110,.28);background:#061826}
.phone>div{position:absolute;inset:0}
.dark{background:${NIGHT};color:#fff}
.cam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.cam img{max-width:${h * 0.16}px}
.top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:6px;padding:16px 10px}
.grow{flex:1}
.pill{display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.45);border-radius:22px;padding:3px 3px 3px 3px}
.pill b{display:block;font-size:12px}.pill small{font-size:10px;color:#7DD3FC}
.plus{width:30px;height:26px;border-radius:13px;background:#7DD3FC;color:${NAVY};display:flex;align-items:center;justify-content:center;font-weight:700}
.av{border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex:none;border:2px solid rgba(255,255,255,.7)}
.count{background:rgba(0,0,0,.45);border-radius:16px;padding:6px 9px;font-size:11px;font-weight:700}
.x{font-size:18px;padding:0 4px}
.badge-row{position:absolute;top:64px;left:12px}
.live{background:${LIVE_RED};color:#fff;font-weight:700;font-size:10px;letter-spacing:.8px;padding:3px 8px;border-radius:6px}
.bottom{position:absolute;left:10px;right:10px;bottom:14px;display:flex;flex-direction:column;gap:6px}
.chat{align-self:flex-start;background:rgba(6,24,38,.62);border-radius:14px;padding:6px 10px;font-size:11.5px;max-width:88%}
.toast{align-self:flex-start;display:flex;align-items:center;gap:10px;border:1px solid ${GOLD};background:rgba(6,24,38,.85);border-radius:20px;padding:5px 12px}
.toast b{display:block;font-size:11px}.toast small{font-size:10px;color:#D6F0FF}.toast em{font-family:Brico;color:${GOLD};font-size:20px}
.bar{display:flex;gap:6px;align-items:center}
.say{flex:1;background:rgba(6,24,38,.72);border-radius:18px;padding:9px 12px;font-size:11px;color:#9FB8CC}
.rb{width:34px;height:34px;border-radius:17px;background:rgba(20,24,30,.78);display:flex;align-items:center;justify-content:center;font-size:14px}
.rb.heart{background:rgba(56,189,248,.92)}.rb.gift{background:${GOLD}}
.score{display:flex;margin:4px 10px;border-radius:10px;overflow:hidden;font-weight:700;font-size:11px}
.score div{padding:5px 8px}.score div+div{text-align:right}
.timer{text-align:center;font-size:11px;color:#D6F0FF;margin:2px 0 6px}
.split{display:flex;height:42%;gap:2px}.split .cam{position:relative;flex:1;border-radius:0}
.split-names{display:flex;justify-content:space-around;font-size:11px;font-weight:700;padding-top:4px}
.host-seat{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;margin-bottom:14px}
.seats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 6px}
.seat{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px}
.empty{width:58px;height:58px;border-radius:50%;border:2px dashed rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-size:22px;color:rgba(255,255,255,.5)}
.sheet{position:absolute;left:0;right:0;bottom:0;background:#0C2338;border-radius:22px 22px 0 0;padding:14px 12px 18px;display:flex;flex-direction:column;gap:10px}
.sheet-head{display:flex;justify-content:space-between;align-items:center}.sheet-head b{font-family:Brico;font-size:18px}
.sheet-head span{font-size:12px;color:#7DD3FC;font-weight:700}.sheet-head i{color:${GOLD};font-style:normal;margin-left:8px}
.gifts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.g{display:flex;flex-direction:column;align-items:center;gap:1px;background:#12304A;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 0}
.g.on{border:1.5px solid #7DD3FC;background:rgba(125,211,252,.12)}
.g span{font-size:22px}.g small{font-size:9.5px}.g em{font-style:normal;font-size:10px;color:#7DD3FC;font-weight:700}
.qty{display:flex;gap:6px;align-items:center}
.qty span{border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:5px 10px;font-size:11px}.qty .on{background:#7DD3FC;color:${NAVY};font-weight:700}
.send{background:#7DD3FC;color:${NAVY};font-weight:700;border-radius:18px;padding:8px 20px;font-size:12px}
.light{background:${SKY};padding:22px 14px;display:flex;flex-direction:column;gap:10px}
.lhead{display:flex;align-items:center;gap:10px;font-family:Brico;font-size:18px;margin-bottom:6px}
.row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.9);border-radius:16px;padding:11px 12px;box-shadow:0 8px 20px rgba(12,74,110,.08)}
.row b{display:block;font-size:12.5px}.row small{font-size:10.5px;color:#4A6680}.row>div{flex:1}
.ri{font-size:20px}
.ok{width:24px;height:24px;border-radius:12px;background:#0369A1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none}
`;

const page = (s, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>${css(w, h)}</style></head><body>
<div class="cap"><div class="brand"><img src="${logoUri}">${brand.name}</div><h1>${s.title}</h1><p class="sub">${s.sub}</p></div>
<div class="phone">${s.body}</div></body></html>`;

const targets = [
  { dir: 'ios', width: 440, height: 956, scale: 3 }, // 1320×2868
  { dir: 'android', width: 360, height: 640, scale: 3 }, // 1080×1920
];

const tmp = mkdtempSync(join(tmpdir(), 'store-shots-'));
const browser = await chromium.launch();
for (const t of targets) {
  const out = join(root, 'store/screenshots', brand.id, t.dir);
  mkdirSync(out, { recursive: true });
  const tab = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: t.scale });
  for (const s of screens) {
    const file = join(tmp, `${t.dir}-${s.id}.html`);
    writeFileSync(file, page(s, t.width, t.height));
    await tab.goto(pathToFileURL(file).href);
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: join(out, `${s.id}.png`) });
  }
  await tab.close();
  console.log(`${t.dir}: ${screens.length} screenshots (${t.width * t.scale}×${t.height * t.scale}) → ${out}`);
}
await browser.close();
