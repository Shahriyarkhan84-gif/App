"""Build docs/plan/ZynaLive_90_Day_Plan.pdf: the 90-day plan with one concrete step per day.

Phases and day ranges follow the original ZynaLive 90 Day Daily Task Plan; each
day is a distinct step, marked against what this repo already has.
Run: python3 docs/plan/plan_90_days.py  (needs Playwright's Chromium, as in CI)
"""
import html, json, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D, P, T = 'done', 'part', 'todo'

PHASES = [
 ('Foundation', 'Repo, backend, environments, schema, email sign-in', [
  (D, 'Create the GitHub repo and folders: app, database, AI agents, API, web dashboards; set up TypeScript, ESLint and CI', '.github/workflows/ci.yml'),
  (D, 'Create the backend and connect the database (Supabase Postgres; NestJS + Prisma mirror for the migration)', 'supabase/, apps/api'),
  (D, 'Configure development, preview (staging) and production build profiles and environment files', 'eas.json, .env.example'),
  (D, 'Design the schema for users, rooms, streams, messages and follows, with row-level security on every table', 'supabase/migrations'),
  (D, 'Email sign-up with a 6-digit code, sign-in, and forgot password', 'src/app/(auth)'),
 ]),
 ('Profiles & accounts', 'Profiles, editing, photos, more sign-in options', [
  (D, 'Profile screen (Me tab): name, ID, role badges, wallet and menu', 'src/app/(tabs)/profile.tsx'),
  (D, 'Edit profile: display name, username, bio, country', 'src/app/profile-edit.tsx'),
  (T, 'Profile photo upload: pick or take a photo, crop, upload to storage, save as avatar (today the photo only comes from Google/Apple)', 'profile-edit.tsx + storage bucket'),
  (D, 'Google and Apple sign-in, and the return screen after the browser', 'AuthForm.tsx, sso-callback.tsx'),
  (D, 'Account safety: delete account in the app and on the web, 18+ notice for going live', 'delete-account.tsx'),
 ]),
 ('Live streaming', 'Go Live, Watch Live, stream management, viewer counts', [
  (D, 'Choose the streaming service: LiveKit for the app today (low delay, needed for PK battles); Amazon IVS is wired in the new API for later', 'src/lib/livekit, apps/api'),
  (D, 'Issue stream tokens on the server only, never in the app', 'supabase/functions/livekit-token'),
  (D, 'Go Live setup: title, category, required cover picture', 'src/app/(tabs)/create.tsx'),
  (D, 'Camera and microphone permissions with a front-camera preview', 'create.tsx'),
  (D, 'Host live screen: publish video, end the stream', 'src/app/host/live.tsx'),
  (D, 'Watch Live screen for viewers', 'src/app/live/[roomId].tsx'),
  (D, 'Live viewer counts kept up to date from LiveKit webhooks', 'supabase/functions/livekit-webhook'),
  (D, 'Stream end summary with AI coaching tips', 'src/app/host/summary.tsx'),
  (D, 'Record live streams and turn them into replays', 'media worker (agents/)'),
  (D, 'Quality: adaptive video, simulcast up to 1080p (HDR replays; live HDR is not possible over WebRTC)', 'LiveStage.tsx'),
 ]),
 ('Social', 'Home feed, Discover, search, follows, chat, notifications', [
  (D, 'Home feed with Following, Popular, Nearby and New tabs', 'src/app/(tabs)/index.tsx'),
  (D, 'Category chips, featured host card and PK Battle Night banner', 'index.tsx'),
  (D, 'Discover page: the Explore tab with shortcuts', 'src/app/(tabs)/explore.tsx'),
  (D, 'Search rooms, people and 8-digit IDs', 'src/app/(tabs)/party.tsx'),
  (D, 'Follow and unfollow, plus the "Following, live now" strip', 'FollowingLive.tsx'),
  (D, 'Live room chat with word filters and anti-spam', 'ChatPanel.tsx'),
  (D, 'Direct messages', 'src/app/chat/[userId].tsx'),
  (D, 'Gifts and the coin wallet (server-side money only)', 'GiftSheet.tsx, wallet.tsx'),
  (D, 'In-app notifications with Mark all read', 'src/app/(tabs)/messages.tsx'),
  (D, 'Rankings, PK battles and events', 'rankings.tsx, events/'),
 ]),
 ('UI/UX, performance, bugs', 'Polish, speed and fixes', [
  (D, 'Design system: theme tokens, app fonts, white theme', 'src/lib/theme.ts'),
  (D, 'Shared buttons, chips and tab bar with tap feedback', 'ui.tsx, Menus.tsx'),
  (D, 'Every screen handles loading, error, empty, offline, permission and disabled states', 'StateView.tsx'),
  (D, 'Launch screen with the written-on Z logo', 'LaunchScreen.tsx'),
  (P, 'Urdu, Hindi and Bengali: tabs, states and menus done; other screens still English', 'src/lib/i18n'),
  (T, 'Move the remaining screen text into the translation files', 'src/lib/i18n/en.ts'),
  (T, 'Accessibility pass: screen-reader labels, 44px touch targets, text contrast on white', 'all screens'),
  (T, 'Skeleton loaders so lists do not flash empty while loading', 'new Skeleton component'),
  (P, 'Image speed: cached images are in; check cover and avatar sizes', 'expo-image'),
  (T, 'List speed audit: long lists virtualized, rows memoized', 'Home, Party, Messages'),
  (T, 'Start-up time: review the 2.3s minimum on the loading screen; load heavy screens later', '_layout.tsx'),
  (D, 'Offline banner and retry on every data screen', 'useOffline, StateView'),
  (P, 'Crash reporting: Sentry is wired, but the organization name in app.json is still a placeholder', 'app.json'),
  (T, 'Bug bash on the preview Android build', 'EAS preview build'),
  (T, 'Fix the bug-bash list and send the fixes over the air', 'eas update'),
 ]),
 ('Safety, verification, admin', 'Moderation, reporting, host verification, analytics, admin dashboard', [
  (D, 'User reports on rooms, messages and profiles', 'reports table'),
  (D, 'AI moderation: hides or warns automatically; anything heavier becomes a proposal for the owner', 'agents/'),
  (D, 'Moderation action ladder with audit logs', 'database functions'),
  (D, 'Room admins (up to 5) can mute, kick, block and report', 'live room'),
  (D, 'Word filters and anti-spam in chat', 'chat'),
  (D, 'Host verification with Didit (ID card + face match)', 'verify-form.tsx, didit functions'),
  (D, 'Agency codes and the in-app agency portal', 'agency.tsx'),
  (D, 'Analytics events (PostHog)', 'src/lib/analytics.ts'),
  (D, 'Business numbers in the AI CEO briefing: daily/monthly users, retention, revenue', 'agents/'),
  (D, 'Owner command center: briefing, proposals, reports, withdrawals, settings', 'src/app/admin'),
  (T, 'Owner screens: users and hosts', 'apps/web or src/app/admin'),
  (T, 'Owner screens: agencies and rooms', 'apps/web'),
  (T, 'Owner screens: coins, gifts and transactions', 'apps/web'),
  (T, 'Owner screen: audit log', 'apps/web'),
  (T, 'Agency web dashboard (9 sections)', 'apps/web'),
 ]),
 ('Testing, security, push, scale', 'Testing, security review, push notifications, scalability', [
  (D, 'Must-pass database tests for money and roles', 'supabase/tests'),
  (D, 'API tests for money rules', 'apps/api (Jest)'),
  (D, 'AI agent tests', 'agents (pytest)'),
  (D, 'Component tests for the shared button, chip and tab bar (npm test, runs in CI)', 'src/components/__tests__'),
  (T, 'End-to-end viewer flow on a real device: join, chat, gift, leave (Maestro)', 'EAS + Maestro'),
  (T, 'End-to-end host flow: go live, end, summary', 'EAS + Maestro'),
  (D, 'Security: row-level security on every table, no signed-out access to functions, secrets only on the server', 'migrations, 10_must_pass.sql'),
  (P, 'Security review of the newest code (run the security-review check before launch)', 'whole repo'),
  (T, 'Push notifications, part 1: install expo-notifications, ask permission, save device tokens', 'new table + RLS'),
  (T, 'Push notifications, part 2: send on followed host live, gifts and messages', 'edge function'),
  (T, 'Push settings per type in Settings', 'settings.tsx'),
  (T, 'Load test: many viewers in one room, busy chat', 'LiveKit + Supabase'),
  (T, 'Database indexes and slow-query review', 'Supabase'),
  (T, 'Capacity plan: LiveKit, Supabase plan limits, video delivery', 'infra'),
  (T, 'Fix everything the tests and review found', 'all'),
 ]),
 ('Launch', 'Beta, final fixes, store assets, production, launch', [
  (D, 'Over-the-air updates installed; first Android build with them started (3 Oct)', 'expo-updates'),
  (T, 'Fill the legal placeholders (company name, support email, retention period, minimum age)', 'privacy.tsx, account-deletion.tsx'),
  (T, 'Publish the web build so the privacy and account-deletion pages have public links', 'web hosting'),
  (T, 'Google Play billing for coins bought on Android, with a server-side receipt check', 'RevenueCat or react-native-iap'),
  (T, 'Decide the coin-to-PKR rate and turn on withdrawals', 'platform settings'),
  (P, 'Store graphics: icon, feature graphic, screenshots (Figma boards are ready)', 'docs/design'),
  (T, 'Store listing text in English and Urdu', 'Play Console'),
  (T, 'Set the real Sentry organization and turn on release tracking', 'app.json'),
  (T, 'Production Android build (app bundle)', 'eas.json production'),
  (T, 'Google Play internal testing track', 'Play Console'),
  (T, 'Closed beta with invited hosts and agencies', 'Play Console'),
  (T, 'Fix beta bugs and send them over the air', 'eas update'),
  (T, 'iOS build and TestFlight', 'EAS'),
  (P, 'Production backend deploy: database migrations, server functions, AI worker', 'Supabase, agents'),
  (T, 'Launch: open testing, then staged production rollout; watch crashes and analytics', 'Play Console'),
 ]),
]

ORIG = [(1,5),(6,10),(11,20),(21,30),(31,45),(46,60),(61,75),(76,90)]
assert [len(p[2]) for p in PHASES] == [b - a + 1 for a, b in ORIG], 'one step per day'

LABEL = {D: 'Done', P: 'Partly done', T: 'To do'}
e = html.escape


def build_html():
    steps = [s for ph in PHASES for s in ph[2]]
    counts = {k: sum(1 for s in steps if s[0] == k) for k in (D, P, T)}
    fonts = {
        'DM Sans': [('400', 'dm-sans/400Regular/DMSans_400Regular.ttf'), ('500', 'dm-sans/500Medium/DMSans_500Medium.ttf'), ('700', 'dm-sans/700Bold/DMSans_700Bold.ttf')],
        'Bricolage Grotesque': [('800', 'bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf')],
    }
    ff = ''.join(f"@font-face{{font-family:'{fam}';font-weight:{w};src:url('file://{ROOT}/node_modules/@expo-google-fonts/{p}')}}" for fam, lst in fonts.items() for w, p in lst)
    day = 1
    sections = []
    for i, (name, sub, items) in enumerate(PHASES):
        a, b = ORIG[i]
        rows = []
        for st, text, where in items:
            rows.append(f'<tr class="{st}"><td class="day">{day}</td><td class="step">{e(text)}<div class="where">{e(where)}</div></td>'
                        f'<td class="st"><span class="chip {st}">{LABEL[st]}</span></td></tr>')
            day += 1
        done = sum(1 for s in items if s[0] == D)
        sections.append(f'<section><div class="ph"><span class="num">{i + 1:02d}</span><div><h2>{e(name)}</h2><p>Days {a}–{b} · {e(sub)}</p></div>'
                        f'<span class="prog">{done}/{len(items)} done</span></div><table>{"".join(rows)}</table></section>')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{ff}
@page {{ size: A4; margin: 16mm 14mm 18mm; }}
:root {{ --ink:#241033; --muted:#6B5285; --faint:#8C76A6; --line:#F0E6F5; --primary:#9333EA; --surface:#F8F3FB; --done:#1FA971; --part:#B7791F; --todo:#9333EA; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:'DM Sans',sans-serif; color:var(--ink); font-size:9.5pt; line-height:1.35; }}
header {{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:12px; }}
h1 {{ font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:26pt; line-height:1; margin:0; letter-spacing:-0.5px; }}
h1 span {{ color:var(--primary); }}
.sub {{ color:var(--muted); margin-top:6px; max-width:330px; }}
.key {{ text-align:right; color:var(--muted); font-size:8.5pt; }}
.totals {{ display:flex; gap:8px; justify-content:flex-end; margin-top:6px; }}
.totals b {{ font-size:13pt; font-variant-numeric:tabular-nums; }}
.tot {{ border:1px solid var(--line); border-radius:8px; padding:4px 10px; background:var(--surface); }}
section {{ break-inside:auto; margin-top:10px; }}
.ph {{ display:flex; align-items:center; gap:10px; background:var(--surface); border-radius:10px; padding:8px 12px; break-after:avoid; }}
.num {{ font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:15pt; color:#fff; background:linear-gradient(135deg,#5B2A9E,#B341E0,#FF6FB0); border-radius:8px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; }}
.ph h2 {{ margin:0; font-size:12pt; }} .ph p {{ margin:1px 0 0; color:var(--muted); font-size:8.5pt; }}
.prog {{ margin-left:auto; font-weight:700; color:var(--muted); font-size:8.5pt; }}
table {{ width:100%; border-collapse:collapse; margin-top:4px; }}
tr {{ break-inside:avoid; }}
td {{ border-bottom:1px solid var(--line); padding:5px 6px; vertical-align:top; }}
td.day {{ width:58px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--muted); white-space:nowrap; }}
td.day::before {{ content:'Day '; font-weight:500; color:var(--faint); }}
.where {{ color:var(--faint); font-size:8pt; margin-top:1px; }}
td.st {{ width:78px; text-align:right; }}
.chip {{ display:inline-block; border-radius:999px; padding:1px 8px; font-size:7.8pt; font-weight:700; border:1px solid; white-space:nowrap; }}
.chip.done {{ color:var(--done); border-color:#BFE8D6; background:#EEFAF4; }}
.chip.part {{ color:var(--part); border-color:#F1D38A; background:#FFF8E6; }}
.chip.todo {{ color:var(--todo); border-color:#E2CCF7; background:#F7EFFE; }}
tr.done .step {{ color:var(--muted); }}
footer {{ margin-top:14px; color:var(--faint); font-size:8pt; border-top:1px solid var(--line); padding-top:8px; }}
</style></head><body>
<header><div><h1>ZynaLive<br><span>90-Day Plan</span></h1><div class="sub">One concrete step for each day, in the same eight phases as the original plan, checked against what the app already has.</div></div>
<div class="key">Status as of 3 October 2026<div class="totals"><span class="tot"><b>{counts[D]}</b> done</span><span class="tot"><b>{counts[P]}</b> partly</span><span class="tot"><b>{counts[T]}</b> to do</span></div></div></header>
{"".join(sections)}
<footer>The original plan named Amazon IVS for live video. The app streams with LiveKit today because PK battles and multi-guest rooms need sub-second delay; Amazon IVS is already wired into the new API (apps/api) if the backend moves. Regenerate this file with: python3 docs/plan/plan_90_days.py</footer>
</body></html>'''


def main():
    out = ROOT / 'docs/plan/ZynaLive_90_Day_Plan.pdf'
    page = ROOT / 'docs/plan/.plan.html'
    page.write_text(build_html())
    js = (f"const {{chromium}}=require('playwright');(async()=>{{const b=await chromium.launch({{executablePath:'/opt/pw-browsers/chromium'}});"
          f"const p=await b.newPage();await p.goto('file://{page}');await p.waitForTimeout(500);"
          f"await p.pdf({{path:{json.dumps(str(out))},format:'A4',printBackground:true,"
          f"displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style=\"font-size:7pt;color:#8C76A6;width:100%;text-align:center\">ZynaLive 90-Day Plan · page <span class=pageNumber></span> of <span class=totalPages></span></div>',"
          f"margin:{{top:'16mm',bottom:'18mm',left:'14mm',right:'14mm'}}}});await b.close();}})();")
    subprocess.run(['node', '-e', js], check=True, env={'NODE_PATH': '/opt/node22/lib/node_modules', 'PATH': '/usr/bin:/bin:/opt/node22/bin'})
    page.unlink()
    print('wrote', out.relative_to(ROOT))


if __name__ == '__main__':
    main()
