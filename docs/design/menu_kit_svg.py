"""Generate the menu-kit design boards (docs/design/menu-kit-{dark,light}.svg).

Eight phone frames, one per menu style in src/components/Menus.tsx, drawn with
the app's theme tokens (src/lib/theme.ts) and the real Ionicons glyphs. The SVGs
import into Figma (drag in → editable named layers) and open in Photoshop or
Illustrator. Re-run after changing tokens or Menus.tsx:

    pip install fonttools && python3 docs/design/menu_kit_svg.py
"""
import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
FONT = TTFont(ICONS / 'Fonts/Ionicons.ttf')
GLYPHS = json.loads((ICONS / 'glyphmaps/Ionicons.json').read_text())
CMAP = FONT.getBestCmap()
GSET = FONT.getGlyphSet()
UPM = FONT['head'].unitsPerEm

THEMES = {
    'dark': dict(background='#170B2E', surface='#241442', surfaceRaised='#2E1B54', tabBar='#140A26', divider='#2A1849',
                 text='#F7F1FF', textFaint='#8F7AB8', primary='#B341E0', primaryText='#FFFFFF', accent='#FF5FA2',
                 violet='#8B5CF6', gold='#FFC24B', goldText='#2A1600', danger='#FF5A61', overlay='rgba(0,0,0,0.6)', board='#0E0620'),
    'light': dict(background='#FDF3FA', surface='#FFFFFF', surfaceRaised='#F6E9FB', tabBar='#FFFFFF', divider='#F1E0F6',
                  text='#241033', textFaint='#8C76A6', primary='#9333EA', primaryText='#FFFFFF', accent='#EC4899',
                  violet='#8B5CF6', gold='#FFC24B', goldText='#2A1600', danger='#D9363E', overlay='rgba(0,0,0,0.45)', board='#EFE3F3'),
}
W, H = 360, 740          # phone frame
GAP, PAD, HEAD = 64, 80, 170
FONT_FAMILY = "'DM Sans', 'Inter', sans-serif"
DISPLAY = "'Bricolage Grotesque', 'DM Sans', sans-serif"


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def icon(name, x, y, size, color, layer=None):
    """Ionicons glyph fitted (centered) into a size×size box at x,y."""
    gname = CMAP[GLYPHS[name]]
    pen = SVGPathPen(GSET)
    GSET[gname].draw(pen)
    s = size / UPM
    # Ionicons glyphs sit on a 0..UPM em square with the baseline at descent.
    desc = FONT['hhea'].descent
    tx, ty = x, y + size + desc * s
    return f'<path id="{esc(layer or "icon-" + name)}" d="{pen.getCommands()}" fill="{color}" transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f} {-s:.5f})"/>'


def text(s, x, y, size, color, weight=400, anchor='start', family=FONT_FAMILY, layer=None):
    return (f'<text id="{esc(layer or "text-" + s)}" x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}">{esc(s)}</text>')


def rect(x, y, w, h, fill, r=0, layer=None, extra=''):
    lid = f' id="{esc(layer)}"' if layer else ''
    return f'<rect{lid} x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" {extra}/>'


def circle(cx, cy, r, fill, layer=None, extra=''):
    lid = f' id="{esc(layer)}"' if layer else ''
    return f'<circle{lid} cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" {extra}/>'


def group(layer, parts, transform=''):
    t = f' transform="{transform}"' if transform else ''
    return f'<g id="{esc(layer)}"{t}>' + ''.join(parts) + '</g>'


class Board:
    def __init__(self, c):
        self.c = c

    # Shared screen chrome ----------------------------------------------------
    def status_bar(self):
        c = self.c
        return group('Status bar', [
            text('9:41', 24, 30, 14, c['text'], 700),
            icon('cellular', 276, 18, 15, c['text']), icon('wifi', 296, 18, 15, c['text']), icon('battery-full', 318, 16, 19, c['text']),
        ])

    def header(self, title, left=None, right=None):
        c = self.c
        parts = []
        x = 20
        if left:
            parts.append(left)
            x = 76
        parts.append(text(title, x, 82, 22, c['text'], 800, family=DISPLAY, layer='Title'))
        if right:
            parts.append(right)
        return group('Header', parts)

    def feed(self, top=104, bottom=H, cols=2):
        """Placeholder live-room cards (the content behind each menu)."""
        c = self.c
        parts, gw = [], (W - 40 - 12 * (cols - 1)) / cols
        y, i = top, 0
        while y + 150 < bottom:
            for k in range(cols):
                x = 20 + k * (gw + 12)
                parts.append(group(f'Card {i + 1}', [
                    rect(x, y, gw, 150, c['surface'], 16),
                    rect(x + 10, y + 10, 40, 18, c['accent'], 6), text('LIVE', x + 30, y + 23, 10, '#fff', 700, 'middle'),
                    rect(x + 10, y + 118, gw * 0.6, 10, c['surfaceRaised'], 5),
                    rect(x + 10, y + 134, gw * 0.35, 8, c['surfaceRaised'], 4),
                ]))
                i += 1
            y += 162
        return group('Feed', parts)

    def frame(self, n, name, body):
        c = self.c
        return group(f'{n} · {name}', [
            rect(0, 0, W, H, c['background'], 40, layer='Screen', extra=f'stroke="{c["divider"]}" stroke-width="1"'),
            f'<clipPath id="clip{n}"><rect width="{W}" height="{H}" rx="40"/></clipPath>',
            f'<g clip-path="url(#clip{n})">' + self.status_bar() + body + '</g>',
        ])

    def round_btn(self, cx, cy, r, fill, name, color, size, layer):
        return group(layer, [circle(cx, cy, r, fill, extra=f'stroke="{self.c["divider"]}" stroke-width="1.5" filter="url(#shadow)"'), icon(name, cx - size / 2, cy - size / 2, size, color)])

    # 1. Grid -------------------------------------------------------------------
    def grid(self):
        c = self.c
        items = [('home', 'Home'), ('play-circle', 'Videos'), ('calendar', 'Events'), ('trophy', 'Rankings'), ('wallet', 'Wallet'), ('settings', 'Settings')]
        tw = (W - 40 - 12) / 2
        parts = []
        for i, (ic, label) in enumerate(items):
            x, y = 20 + (i % 2) * (tw + 12), 110 + (i // 2) * (tw + 12)
            parts.append(group(f'Tile · {label}', [
                rect(x, y, tw, tw, 'url(#tileGrad)', 20),
                icon(ic, x + tw / 2 - 18, y + tw / 2 - 30, 36, '#fff'),
                text(label, x + tw / 2, y + tw / 2 + 30, 15, '#fff', 700, 'middle'),
            ]))
        return self.header('Menu') + group('MenuGrid', parts)

    # 2. Side menu ----------------------------------------------------------------
    def side(self):
        c = self.c
        btn = group('SideMenuButton', [circle(42, 76, 22, c['surfaceRaised']), icon('menu', 31, 65, 22, c['text'])])
        items = [('play-circle-outline', 'Videos'), ('calendar-outline', 'Events'), ('trophy-outline', 'Rankings'),
                 ('wallet-outline', 'Wallet & history'), ('settings-outline', 'Settings'), ('help-circle-outline', 'Help & support')]
        pw = 288
        rows = [icon('close', 20, 56, 26, c['text'], 'Close'), text('Zynalive', 20, 128, 26, c['text'], 800, family=DISPLAY, layer='Wordmark')]
        for i, (ic, label) in enumerate(items):
            y = 160 + i * 52
            rows.append(group(f'Item · {label}', [icon(ic, 20, y, 22, c['text']), text(label, 58, y + 17, 16, c['text'], 500)]))
        return (self.header('Zynalive', left=btn) + self.feed() + rect(0, 0, W, H, c['overlay'], layer='Overlay') +
                group('SideMenu', [rect(0, 0, pw, H, c['tabBar'], 0, extra='filter="url(#shadow)"'), *rows]))

    # 3. Tab bar --------------------------------------------------------------------
    def tabbar(self):
        c = self.c
        top = H - 62 - 24
        tabs = [('home', 'Home', True), ('people-outline', 'Party', False), None, ('chatbox-outline', 'Messages', False), ('person-outline', 'Me', False)]
        slot = W / 5
        parts = [rect(0, top, W, 62 + 24 + 30, c['tabBar'], 24, extra='filter="url(#shadow)"')]
        for i, tab in enumerate(tabs):
            cx = slot * i + slot / 2
            if tab is None:
                parts.append(group('TabBarCenterButton · Go live', [
                    circle(cx, top + 11, 31, c['tabBar']), circle(cx, top + 11, 27, c['primary'], extra='filter="url(#glow)"'),
                    icon('add', cx - 14, top - 3, 28, c['primaryText'])]))
                continue
            ic, label, on = tab
            col = c['primary'] if on else c['textFaint']
            parts.append(group(f'TabBarItem · {label}{" (active)" if on else ""}', [
                icon(ic, cx - 11.5, top + 10, 23, col), text(label, cx, top + 49, 11, col, 700 if on else 500, 'middle')]))
        return self.header('Home') + self.feed(bottom=top) + group('TabBar', parts)

    # 4. FAB --------------------------------------------------------------------------
    def fab(self):
        c = self.c
        cx, cy = W - 20 - 29, H - 40 - 29
        acts = [('calendar-outline', 'Events'), ('videocam', 'Go live'), ('cloud-upload-outline', 'Upload video')]
        parts = []
        for i, (ic, label) in enumerate(acts):
            y = cy - 29 - 12 - 23 - i * 58
            lw = 12 + len(label) * 7.2
            parts.append(group(f'Action · {label}', [
                rect(cx - 23 - 10 - lw - 5, y - 13, lw, 26, c['tabBar'], 8),
                text(label, cx - 23 - 10 - lw / 2 - 5, y + 5, 12, c['text'], 700, 'middle'),
                circle(cx - 5 + 5, y, 23, c['accent']), icon(ic, cx - 10.5, y - 10.5, 21, '#fff')]))
        parts.append(group('FAB (open)', [circle(cx, cy, 29, c['accent'], extra='filter="url(#glow)"'),
                                          f'<g transform="rotate(45 {cx} {cy})">{icon("add", cx - 15, cy - 15, 30, "#fff")}</g>']))
        return self.header('Videos') + self.feed() + rect(0, 0, W, H, c['overlay'], layer='Backdrop') + group('FabMenu', parts)

    # 5. Sheet ------------------------------------------------------------------------
    def sheet(self):
        c = self.c
        acts = [('share-social-outline', 'Share', False), ('bookmark-outline', 'Save', False), ('flag-outline', 'Report', False), ('trash-outline', 'Remove', True)]
        top = H - 70 - len(acts) * 46 - 90
        parts = [rect(0, top, W, H - top + 40, c['surface'], 24), rect(W / 2 - 20, top + 10, 40, 4, c['textFaint'], 2, layer='Handle'),
                 text('More options', 24, top + 50, 18, c['text'], 700, layer='Sheet title')]
        for i, (ic, label, bad) in enumerate(acts):
            y = top + 72 + i * 46
            col = c['danger'] if bad else c['text']
            parts.append(group(f'Row · {label}', [icon(ic, 24, y, 22, col), text(label, 62, y + 17, 16, col)]))
        by = top + 72 + len(acts) * 46 + 8
        parts.append(group('Cancel (gold)', [rect(24, by, W - 48, 50, c['gold'], 25), text('Cancel', W / 2, by + 31, 16, c['goldText'], 700, 'middle')]))
        return self.header('Videos') + self.feed() + rect(0, 0, W, H, c['overlay'], layer='Overlay') + group('ActionSheet', parts)

    # 6. Three dots -------------------------------------------------------------------
    def dots(self):
        c = self.c
        dots = group('OverflowMenu button', [circle(W - 40, 76, 20, c['surfaceRaised']), icon('ellipsis-vertical', W - 50, 66, 20, c['text'])])
        acts = [('share-social-outline', 'Share', False), ('text-outline', 'Captions', False), ('flag-outline', 'Report', False), ('trash-outline', 'Remove', True)]
        mw, mx, my = 200, W - 20 - 200, 104
        parts = [rect(mx, my, mw, 12 + len(acts) * 44, c['tabBar'], 16, extra=f'stroke="{c["divider"]}" filter="url(#shadow)"')]
        for i, (ic, label, bad) in enumerate(acts):
            y = my + 6 + i * 44
            col = c['danger'] if bad else c['text']
            parts.append(group(f'Menuitem · {label}', [icon(ic, mx + 16, y + 12, 19, col), text(label, mx + 46, y + 28, 15, col)]))
        player = group('Video', [rect(0, 104, W, 203, '#000'), icon('play', W / 2 - 24, 181, 48, '#fff')])
        return self.header('Video', right=dots) + player + self.feed(top=320) + group('Popover', parts)

    # 7. Rectangular rail -------------------------------------------------------------
    def rail(self):
        c = self.c
        items = ['home', 'play-circle-outline', 'calendar-outline', 'trophy-outline', 'wallet-outline', 'settings-outline']
        parts = [rect(0, 0, 72, H, c['primary'])]
        for i, ic in enumerate(items):
            y = 60 + i * 62
            if i == 0:
                parts.append(rect(10, y, 52, 52, 'rgba(255,255,255,0.22)', 16, layer='Active'))
            parts.append(icon(ic, 24, y + 14, 24, c['primaryText'], f'Rail · {ic}'))
        body = [text('Home', 92, 82, 22, c['text'], 800, family=DISPLAY)]
        for i in range(4):
            body.append(rect(92, 110 + i * 150, W - 112, 136, c['surface'], 16, layer=f'Card {i + 1}'))
        return group('NavRail', parts) + group('Content', body)

    # 8. Rudder -----------------------------------------------------------------------
    def rudder(self):
        c = self.c
        cy = H - 70
        bar = group('RudderBar', [
            self.round_btn(W / 2 - 110, cy, 24, c['tabBar'], 'home-outline', c['accent'], 22, 'Left · Home'),
            group('Center · Go live', [circle(W / 2, cy, 34, c['accent'], extra='filter="url(#glow)"'), icon('videocam', W / 2 - 17, cy - 17, 34, '#fff')]),
            self.round_btn(W / 2 + 110, cy, 24, c['tabBar'], 'person-outline', c['accent'], 22, 'Right · Me'),
        ])
        return self.header('Home') + self.feed(bottom=cy - 50) + bar

    def render(self, theme):
        c = self.c
        frames = [('Grid', self.grid), ('Side Menu', self.side), ('Tab Bar', self.tabbar), ('FAB', self.fab),
                  ('Sheet', self.sheet), ('Three Dots', self.dots), ('Rectangular', self.rail), ('Rudder', self.rudder)]
        cols = 4
        bw = PAD * 2 + cols * W + (cols - 1) * GAP
        bh = HEAD + 2 * (H + 60) + GAP + PAD
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{bw}" height="{bh}" viewBox="0 0 {bw} {bh}">',
               '<defs>',
               f'<linearGradient id="tileGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c["violet"]}"/><stop offset="1" stop-color="{c["primary"]}"/></linearGradient>',
               '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="-2" stdDeviation="8" flood-color="#000" flood-opacity="0.18"/></filter>',
               f'<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="{c["primary"]}" flood-opacity="0.5"/></filter>',
               '</defs>',
               rect(0, 0, bw, bh, c['board'], layer='Board'),
               text('Zynalive — Menu styles', PAD, 96, 44, c['text'], 800, family=DISPLAY, layer='Board title'),
               text(f'{theme.title()} theme · src/components/Menus.tsx · tokens from src/lib/theme.ts', PAD, 132, 18, c['textFaint'], 500, layer='Board subtitle')]
        for i, (name, fn) in enumerate(frames):
            x = PAD + (i % cols) * (W + GAP)
            y = HEAD + (i // cols) * (H + 60 + GAP)
            out.append(group(f'Style {i + 1}', [text(f'{i + 1}  {name}', 4, 0, 20, c['text'], 700, layer='Label'),
                                                f'<g transform="translate(0 24)">{self.frame(i + 1, name, fn())}</g>'],
                             transform=f'translate({x} {y})'))
        out.append('</svg>')
        return '\n'.join(out)


if __name__ == '__main__':
    for theme, tokens in THEMES.items():
        path = Path(__file__).with_name(f'menu-kit-{theme}.svg')
        path.write_text(Board(tokens).render(theme))
        print('wrote', path.relative_to(ROOT))
