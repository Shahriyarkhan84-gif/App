"""Generate Figma-importable boards of the app's main flow (docs/design/screens/*.svg).

Ten 390x844 phone screens in the order the app opens: logo loading, Welcome,
Sign up, Verify email, Sign in, Reset password (2 steps), Home, Explore and
Notifications. Drawn from the real screen code with the theme tokens in
src/lib/theme.ts, the app's fonts (Bricolage Grotesque, DM Sans) and the real
Ionicons glyphs. Drag the SVGs into Figma: each becomes a frame of named,
editable layers (text stays text). Names and numbers are sample data.

    pip install fonttools && python3 docs/design/app_screens_svg.py
"""
import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/design/screens'
ICONS = ROOT / 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
FONT = TTFont(ICONS / 'Fonts/Ionicons.ttf')
GLYPHS = json.loads((ICONS / 'glyphmaps/Ionicons.json').read_text())
CMAP, GSET, UPM, DESC = FONT.getBestCmap(), FONT.getGlyphSet(), FONT['head'].unitsPerEm, FONT['hhea'].descent

W, H = 390, 844
C = dict(background='#170B2E', surface='#241442', surfaceRaised='#2E1B54', border='#3A2569', divider='#2A1849', tabBar='#140A26',
         text='#F7F1FF', textMuted='#C9B8E8', textFaint='#8F7AB8', primary='#B341E0', accent='#FF5FA2', gold='#FFC24B',
         onGold='#2A1A00', success='#34C789')
GRADIENT = ('#5B2A9E', '#B341E0', '#FF6FB0')
BODY = "DM Sans"
DISPLAY = "Bricolage Grotesque"


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def icon(name, x, y, size, color):
    pen = SVGPathPen(GSET)
    GSET[CMAP[GLYPHS[name]]].draw(pen)
    s = size / UPM
    return (f'<path id="icon/{name}" d="{pen.getCommands()}" fill="{color}" '
            f'transform="translate({x:.2f} {y + (UPM + DESC) * s:.2f}) scale({s:.5f} {-s:.5f})"/>')


def text(s, x, y, size, color, weight=400, anchor='start', family=BODY, ls=0, name=None):
    lsp = f' letter-spacing="{ls}"' if ls else ''
    return (f'<text id="{esc(name or s)[:60]}" x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}"'
            f'{lsp} fill="{color}" text-anchor="{anchor}">{esc(s)}</text>')


def rect(x, y, w, h, fill, r=0, name=None, stroke=None):
    lid = f' id="{esc(name)}"' if name else ''
    st = f' stroke="{stroke}" stroke-width="1"' if stroke else ''
    return f'<rect{lid} x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st}/>'


def group(name, *parts):
    return f'<g id="{esc(name)}">' + ''.join(parts) + '</g>'


def wordmark(x, y, size, anchor='start'):
    return (f'<text id="Wordmark" x="{x}" y="{y}" font-family="{DISPLAY}" font-size="{size}" font-weight="800" letter-spacing="-0.5" '
            f'text-anchor="{anchor}"><tspan fill="{C["text"]}">zyna</tspan><tspan fill="{C["primary"]}">live</tspan></text>')


def status_bar():
    return group('Status bar', text('9:41', 28, 30, 15, C['text'], 600), text('●●● ▮', W - 28, 30, 13, C['text'], 600, 'end'))


# --- Components -------------------------------------------------------------

def logo(x, y, size=96):
    k = size / 512
    p = lambda pts: ' '.join(f'{x + a * k:.2f},{y + b * k:.2f}' for a, b in pts)
    return group('Logo',
        f'<rect id="Tile" x="{x}" y="{y}" width="{size}" height="{size}" rx="{115 * k:.2f}" fill="url(#brand)"/>',
        rect(x + 136 * k, y + 129 * k, 208 * k, 58 * k, '#FFFFFF', name='Z top'),
        f'<polygon id="Z diagonal" points="{p([(273.7, 187), (344, 187), (344, 200.3), (206.4, 356), (131, 356), (131, 348.5)])}" fill="#FFFFFF"/>',
        rect(x + 131 * k, y + 356 * k, 218 * k, 57 * k, '#FFFFFF', name='Z bottom'),
        f'<circle id="Dot" cx="{x + 417 * k:.2f}" cy="{y + 92 * k:.2f}" r="{43 * k:.2f}" fill="#FFFFFF"/>')


def button(label, x, y, w, kind='primary', ic=None, h=52):
    if kind == 'primary':
        bg = rect(x, y, w, h, 'url(#brand-h)', h / 2, 'Fill')
        fg = '#FFFFFF'
    else:
        bg = rect(x, y, w, h, C['surface'], h / 2, 'Fill', C['border'])
        fg = C['text']
    cx = x + w / 2
    if ic:
        lbl = text(label, cx + 12, y + h / 2 + 6, 16, fg, 700, 'middle')
        icn = icon(ic, cx - len(label) * 4.4 - 14, y + h / 2 - 10, 20, fg)
        return group(f'Button / {label}', bg, icn, lbl)
    return group(f'Button / {label}', bg, text(label, cx, y + h / 2 + 6, 16, fg, 700, 'middle'))


def icon_button(ic, x, y, color=None, name=None, dot=False):
    parts = [f'<circle cx="{x + 22}" cy="{y + 22}" r="22" fill="{C["surfaceRaised"]}"/>', icon(ic, x + 12, y + 12, 20, color or C['text'])]
    if dot:
        parts.append(f'<circle cx="{x + 31}" cy="{y + 13}" r="4" fill="{C["primary"]}"/>')
    return group(name or f'Icon button / {ic}', *parts)


def field(label, value, x, y, w, filled=True):
    return group(f'Field / {label}',
        text(label, x, y + 13, 13, C['textMuted'], 500),
        rect(x, y + 19, w, 52, C['surface'], 14, 'Input', C['border']),
        text(value, x + 16, y + 19 + 31, 15, C['text'] if filled else C['textFaint']))


def or_divider(x, y, w):
    return group('Or divider', rect(x, y, w / 2 - 22, 1, C['divider']), text('or', x + w / 2, y + 5, 13, C['textFaint'], 400, 'middle'),
                 rect(x + w / 2 + 22, y, w / 2 - 22, 1, C['divider']))


def terms(y):
    return group('Terms',
        text('By continuing you agree to the Terms and Privacy Policy.', W / 2, y, 12, C['textFaint'], 500, 'middle'),
        text('You must be 18+ to go live.', W / 2, y + 18, 12, C['textFaint'], 500, 'middle'))


def auth_top():
    return group('Top bar', icon_button('chevron-back', 24, 56, name='Back'), wordmark(W / 2, 86, 24, 'middle'))


TABS = [('Home', 'home-outline', 'home'), ('Explore', 'compass-outline', 'compass'), None,
        ('Messages', 'chatbox-outline', 'chatbox'), ('Me', 'person-outline', 'person')]


def tab_bar(active):
    top = H - 82
    slot = W / len(TABS)
    parts = [f'<path id="Bar" d="M0 {top + 24} Q0 {top} 24 {top} H{W - 24} Q{W} {top} {W} {top + 24} V{H} H0 Z" fill="{C["tabBar"]}"/>']
    for i, t in enumerate(TABS):
        cx = slot * i + slot / 2
        if t is None:
            parts.append(group('Go live', f'<circle cx="{cx}" cy="{top + 10}" r="28" fill="url(#brand)" stroke="{C["tabBar"]}" stroke-width="4"/>',
                               icon('add', cx - 14, top - 4, 28, '#FFFFFF')))
            continue
        label, ic, ic_on = t
        on = label == active
        col = C['primary'] if on else C['textFaint']
        items = []
        if on:
            items.append(rect(cx - 24, top + 8, 48, 28, '#B341E02E', 14, 'Active pill'))
        items += [icon(ic_on if on else ic, cx - 11, top + 11, 22, col), text(label, cx, top + 50, 11, col, 700 if on else 500, 'middle')]
        parts.append(group(f'Tab / {label}', *items))
    return group('Tab bar', *parts)


def live_badge(x, y):
    return group('Live badge', rect(x, y, 50, 20, 'url(#brand-h)', 6), f'<circle cx="{x + 11}" cy="{y + 10}" r="3" fill="#fff"/>',
                 text('LIVE', x + 19, y + 14, 11, '#FFFFFF', 700, ls=0.6))


def viewers(x_right, y, n):
    w = 22 + len(n) * 7 + 8
    return group('Viewer count', rect(x_right - w, y, w, 20, '#00000080', 6), icon('eye-outline', x_right - w + 8, y + 3.5, 13, '#fff'),
                 text(n, x_right - 8, y + 14, 12, '#FFFFFF', 500, 'end'))


def room_card(x, y, w, name, title, n, tone, rank=None):
    h = round(w * 1.33)
    parts = [f'<clipPath id="clip-{name}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16"/></clipPath>',
             f'<g clip-path="url(#clip-{name})">', rect(x, y, w, h, tone, 0, 'Cover'),
             text(name[0], x + w / 2, y + h / 2 + 34, 96, '#FFFFFF24', 800, 'middle', DISPLAY, name='Initial'),
             f'<rect x="{x}" y="{y + h - 70}" width="{w}" height="70" fill="url(#shade)"/>', '</g>',
             live_badge(x + 10, y + 10), viewers(x + w - 10, y + 10, n),
             text(name, x + 12, y + h - 30, 15, '#FFFFFF', 700), text(title, x + 12, y + h - 13, 12, '#E4DFEC', 500)]
    if rank:
        parts.append(group('Top badge', rect(x + 10, y + h - 64, 54, 16, C['gold'], 8), icon('trophy', x + 16, y + h - 60.5, 9, C['onGold']),
                           text(f'TOP {rank}', x + 28, y + h - 52.5, 9, C['onGold'], 800)))
    return group(f'Room card / {name}', *parts)


# --- Screens ----------------------------------------------------------------

def s_launch():
    return [logo(W / 2 - 48, 294), wordmark(W / 2, 447, 40, 'middle'),
            text('Go live, meet people and support', W / 2, 483, 15, C['textMuted'], 400, 'middle'),
            text('the hosts you love.', W / 2, 504, 15, C['textMuted'], 400, 'middle'),
            group('Loading dots', *(f'<circle cx="{W / 2 - 16 + i * 16}" cy="546" r="4" fill="{C["gold"] if i == 1 else C["primary"]}" '
                                    f'opacity="{1 if i == 0 else 0.35}"/>' for i in range(3)))]


def s_welcome():
    tiles = group('Tiles', *(rect(24 + i * 62, 100 + (18 if i % 2 else 0), 56, 76, col, 14) for i, col in
                             enumerate(['#5B2A9E', '#8B3CD6', '#B341E0', '#FF6FB0'])))
    return [tiles, wordmark(24, 246, 44),
            text('Go live, meet people and support the', 24, 284, 17, C['textMuted']),
            text('hosts you love.', 24, 308, 17, C['textMuted']),
            button('Create account', 24, 534, W - 48), button('Sign in', 24, 598, W - 48, 'secondary'),
            or_divider(24, 670, W - 48), button('Continue with Google', 24, 690, W - 48, 'secondary', 'logo-google'), terms(772)]


def s_signup():
    return [auth_top(), text('Create your account', 24, 153, 26, C['text'], 800, family=DISPLAY),
            text('Watch live, chat, send gifts — or go live', 24, 180, 15, C['textMuted']), text('yourself.', 24, 201, 15, C['textMuted']),
            button('Continue with Google', 24, 226, W - 48, 'secondary', 'logo-google'),
            button('Continue with Apple', 24, 290, W - 48, 'secondary', 'logo-apple'), or_divider(24, 362, W - 48),
            field('Email', 'areeba@example.com', 24, 382, W - 48), field('Password', '••••••••••', 24, 470, W - 48),
            button('Continue', 24, 558, W - 48),
            f'<text id="Have account" x="{W / 2}" y="640" font-family="{BODY}" font-size="15" text-anchor="middle">'
            f'<tspan fill="{C["textMuted"]}">Already have an account? </tspan><tspan fill="{C["primary"]}" font-weight="700">Sign in</tspan></text>',
            terms(684)]


def s_verify():
    return [auth_top(), text('Check your email', 24, 153, 26, C['text'], 800, family=DISPLAY),
            text('We sent a 6-digit code to areeba@example.com.', 24, 180, 15, C['textMuted']),
            field('Verification code', '482 913', 24, 206, W - 48), button('Verify & continue', 24, 294, W - 48), terms(394)]


def s_signin():
    return [auth_top(), text('Welcome back', 24, 153, 26, C['text'], 800, family=DISPLAY),
            text('Sign in to join the live rooms.', 24, 180, 15, C['textMuted']),
            button('Continue with Google', 24, 206, W - 48, 'secondary', 'logo-google'),
            button('Continue with Apple', 24, 270, W - 48, 'secondary', 'logo-apple'), or_divider(24, 342, W - 48),
            field('Email', 'areeba@example.com', 24, 362, W - 48), field('Password', '••••••••', 24, 450, W - 48),
            text('Forgot password?', W - 24, 556, 15, C['accent'], 700, 'end', name='Forgot password link'),
            button('Sign in', 24, 574, W - 48),
            f'<text id="New here" x="{W / 2}" y="656" font-family="{BODY}" font-size="15" text-anchor="middle">'
            f'<tspan fill="{C["textMuted"]}">New here? </tspan><tspan fill="{C["primary"]}" font-weight="700">Create an account</tspan></text>',
            terms(700)]


def s_reset():
    return [auth_top(), text('Reset your password', 24, 153, 26, C['text'], 800, family=DISPLAY),
            text("We'll email you a code to set a new password.", 24, 180, 15, C['textMuted']),
            field('Email', 'areeba@example.com', 24, 206, W - 48), button('Send reset code', 24, 294, W - 48),
            button('Back to sign in', 24, 358, W - 48, 'secondary'), terms(458)]


def s_newpass():
    return [auth_top(), text('Set a new password', 24, 153, 26, C['text'], 800, family=DISPLAY),
            text('Enter the code we sent to areeba@example.com.', 24, 180, 15, C['textMuted']),
            field('Reset code', '482 913', 24, 206, W - 48), field('New password', '••••••••••', 24, 294, W - 48),
            button('Reset password', 24, 382, W - 48), button('Resend code', 24, 446, W - 48, 'secondary'), terms(546)]


def s_home():
    header = group('Header', icon_button('menu', 16, 48, name='Menu'), wordmark(70, 81, 28),
                   icon_button('wallet-outline', W - 16 - 44 * 3 - 16, 48, C['gold'], 'Wallet'),
                   icon_button('search', W - 16 - 44 * 2 - 8, 48, name='Search'),
                   icon_button('notifications-outline', W - 16 - 44, 48, name='Notifications', dot=True))
    tabs, x = [], 16
    for label, w in [('Following', 76), ('Popular', 66), ('Nearby', 58), ('New', 36)]:
        on = label == 'Popular'
        tabs.append(text(label, x, 125, 17, C['text'] if on else C['textFaint'], 700 if on else 500))
        if on:
            tabs.append(rect(x, 137, w, 3, C['primary'], 1.5, 'Underline'))
        x += w + 20
    chips, x = [], 16
    for label in ['All', 'Chat', 'Music', 'Gaming', 'Talent', 'Education']:
        w = len(label) * 8 + 32
        on = label == 'All'
        chips.append(group(f'Chip / {label}', rect(x, 152, w, 36, C['text'] if on else C['surfaceRaised'], 18, stroke=None if on else C['border']),
                           text(label, x + w / 2, 175, 14, C['background'] if on else C['textMuted'], 500, 'middle')))
        x += w + 8
    featured = group('Featured host', '<clipPath id="clip-feat"><rect x="16" y="200" width="358" height="96" rx="18"/></clipPath>',
                     '<g clip-path="url(#clip-feat)">', rect(16, 200, 358, 96, 'url(#brand)'), rect(16, 200, 358, 96, '#0000005C'), '</g>',
                     rect(28, 210, 60, 76, C['surfaceRaised'], 12, 'Avatar'), text('A', 58, 259, 30, '#FFFFFF59', 800, 'middle', DISPLAY),
                     text('Areeba K.', 100, 240, 15, '#FFFFFF', 700), live_badge(178, 226),
                     text('Friday night singing · Music', 100, 262, 12, '#FFFFFFD9', 500),
                     rect(296, 232, 66, 32, '#FFFFFF', 16, 'Follow'), text('Follow', 329, 253, 12, C['primary'], 800, 'middle'))
    pk = group('PK Battle banner', rect(16, 306, 358, 84, C['surface'], 18, stroke=C['divider']), rect(32, 322, 52, 52, C['gold'], 14),
               text('PK', 58, 355, 20, C['onGold'], 800, 'middle', DISPLAY), text('PK Battle Night', 100, 342, 17, C['text'], 700),
               text('Hosts go head-to-head — gifts decide the', 100, 362, 13, C['textMuted']), text('winner', 100, 378, 13, C['textMuted']),
               icon('chevron-forward', 344, 338, 20, C['textFaint']))
    cw = (W - 32 - 10) / 2
    grid = group('Room grid', room_card(16, 400, cw, 'Hamza', 'Late night chat · Chat', '1.8K', '#5B2A4A', 2),
                 room_card(16 + cw + 10, 400, cw, 'Simra', 'Bhangra practice · Talent', '942', '#1F4A5C', 3),
                 room_card(16, 641, cw, 'Faizan', 'Remix hour · Music', '610', '#4A2F6B'),
                 room_card(16 + cw + 10, 641, cw, 'Nabeel', 'Ranked grind · Gaming', '388', '#2E4A2A'))
    return [header, group('Feed tabs', *tabs), group('Categories', *chips), featured, pk, grid, tab_bar('Home')]


def s_explore():
    tiles = [('people', 'Party rooms', 'Voice & video rooms', ('#5B2A9E', '#B341E0')),
             ('play-circle', 'Videos', 'Replays and uploads', ('#B341E0', '#FF6FB0')),
             ('calendar', 'Events', 'Races and PK leagues', ('#0E8A7A', '#34C789')),
             ('trophy', 'Rankings', 'Top hosts and gifters', ('#E0A83A', '#FFC24B'))]
    you = [('wallet', 'Wallet & history', 'Coins and history', ('#E0A83A', '#FFC24B')),
           ('videocam', 'Become a host', 'Verify and go live', ('#B341E0', '#FF6FB0')),
           ('business', 'Agency portal', '4-digit agency code', ('#5B2A9E', '#8B5CF6')),
           ('help-buoy', 'Help & support', 'FAQ and support', ('#1F6FAE', '#4B7BE0')),
           ('person-circle', 'Edit profile', 'Photo, name and bio', ('#FF5FA2', '#FF6FB0')),
           ('settings', 'Settings', 'Language and account', ('#3A2569', '#6A45A0'))]
    tw = (W - 32 - 10) / 2
    defs = []

    def grid(items, y0):
        out = []
        for i, (ic, label, body, (g1, g2)) in enumerate(items):
            x, y = 16 + (i % 2) * (tw + 10), y0 + (i // 2) * 122
            gid = f'g-{label.replace(" ", "").replace("&", "")}'
            defs.append(f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{g1}"/><stop offset="1" stop-color="{g2}"/></linearGradient>')
            out.append(group(f'Tile / {label}', rect(x, y, tw, 112, C['surface'], 20, stroke=C['divider']), rect(x + 14, y + 14, 40, 40, f'url(#{gid})', 12),
                             icon(ic, x + 23, y + 23, 22, '#FFFFFF'), text(label, x + 14, y + 76, 14, C['text'], 700),
                             text(body, x + 14, y + 94, 12, C['textMuted'], 500)))
        return out
    parts = [text('Explore', 16, 80, 26, C['text'], 800, family=DISPLAY), text('Rooms, events, rankings and more.', 16, 103, 15, C['textMuted']),
             group('Search', rect(16, 120, W - 32, 48, C['surface'], 24, stroke=C['border']), icon('search', 32, 135, 18, C['textFaint']),
                   text('Search parties and hosts', 60, 149, 15, C['textFaint'])),
             text('Watch', 16, 200, 14, C['textMuted'], 700), group('Watch', *grid(tiles, 212)),
             text('You', 16, 476, 14, C['textMuted'], 700), group('You', *grid(you, 488)), tab_bar('Explore')]
    return ['<defs>' + ''.join(defs) + '</defs>'] + parts


def s_notifications():
    rows = [(True, 'You’re verified — Host badge unlocked', 'Your identity is confirmed. You can now go', 'live and withdraw earnings.', '2m'),
            (True, 'Hamza sent you a Lion ×3', '+2,997 coins added to your earnings.', None, '1h'),
            (False, 'Welcome to Starlight Agency', 'You joined with agency code 4821.', None, '3h'),
            (False, 'Zara started following you', 'Say hi in Messages.', None, 'Yesterday'),
            (False, 'Withdrawal paid', 'PKR 5,000 sent to Easypaisa 0300•••4567.', None, '12 Sep')]
    out, y = [], 186
    for unread, title, b1, b2, t in rows:
        h = 84 if b2 else 66
        items = []
        if unread:
            items.append(rect(16, y, W - 32, h, C['surface'], 16, 'Unread'))
        items += [text(title, 30, y + 26, 15, C['text'], 700), text(b1, 30, y + 46, 13, C['textMuted'])]
        if b2:
            items.append(text(b2, 30, y + 64, 13, C['textMuted']))
        items.append(text(t, W - 30, y + 24, 12, C['textFaint'], 500, 'end'))
        out.append(group(f'Notification / {title}', *items))
        y += h + 6
    return [text('Messages', 16, 82, 26, C['text'], 800, family=DISPLAY),
            group('Segmented', rect(16, 100, W - 32, 44, C['surface'], 22), rect(W / 2 + 1, 104, W / 2 - 21, 36, C['text'], 18),
                  text('Chats', W / 4 + 8, 127, 13, C['textMuted'], 700, 'middle'), text('Notifications', W * 3 / 4 - 8, 127, 13, C['background'], 700, 'middle')),
            text('Mark all read', W - 16, 172, 13, C['accent'], 700, 'end', name='Mark all read'),
            group('Notifications', *out), tab_bar('Messages')]


SCREENS = [('01 Logo loading', s_launch), ('02 Welcome', s_welcome), ('03 Sign up', s_signup), ('04 Verify email', s_verify),
           ('05 Sign in', s_signin), ('06 Reset password', s_reset), ('07 Set new password', s_newpass), ('08 Home', s_home),
           ('09 Explore', s_explore), ('10 Notifications', s_notifications)]

DEFS = ('<defs>'
        f'<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{GRADIENT[0]}"/><stop offset="0.5" stop-color="{GRADIENT[1]}"/><stop offset="1" stop-color="{GRADIENT[2]}"/></linearGradient>'
        f'<linearGradient id="brand-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{GRADIENT[0]}"/><stop offset="0.5" stop-color="{GRADIENT[1]}"/><stop offset="1" stop-color="{GRADIENT[2]}"/></linearGradient>'
        '<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/></linearGradient>'
        '</defs>')


def screen_svg(name, fn, dx=0, dy=0, standalone=True):
    body = (f'<g id="{esc(name)}" transform="translate({dx} {dy})">'
            f'<clipPath id="frame-{dx}"><rect width="{W}" height="{H}"/></clipPath><g clip-path="url(#frame-{dx})">'
            + rect(0, 0, W, H, C['background'], 0, 'Background') + status_bar() + ''.join(fn()) + '</g></g>')
    if not standalone:
        return body
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{DEFS}{body}</svg>'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in SCREENS:
        (OUT / f'{name.lower().replace(" ", "-")}.svg').write_text(screen_svg(name, fn))
    gap, pad = 80, 80
    bw, bh = pad * 2 + len(SCREENS) * W + (len(SCREENS) - 1) * gap, pad * 2 + H + 60
    frames = ''.join(text(n, pad + i * (W + gap), pad + 20, 20, '#C9B8E8', 700, name=f'Label {n}') + screen_svg(n, fn, pad + i * (W + gap), pad + 60, False)
                     for i, (n, fn) in enumerate(SCREENS))
    board = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{bw}" height="{bh}" viewBox="0 0 {bw} {bh}">{DEFS}'
             f'<rect id="Board" width="{bw}" height="{bh}" fill="#0E0620"/>{frames}</svg>')
    (ROOT / 'docs/design/app-screens.svg').write_text(board)
    print(f'wrote {len(SCREENS)} screens to {OUT.relative_to(ROOT)} and docs/design/app-screens.svg')


if __name__ == '__main__':
    main()
