# Live screens analysis: Host Live and Viewer Watch

**Date:** 2026-10-19 · **Commit:** `8c89bcb` (0.9.65) · **By:** App Analyst (read-only: no code changed)
**Scope:** `src/app/host/live.tsx` (host while live), `src/app/(tabs)/create.tsx` (go-live setup), `src/app/live/[roomId].tsx` (viewer), `src/app/host/summary.tsx`, the components they use (`ChatPanel`, `GiftSheet`/`GiftToasts`, `LiveStage`, `PkBattle`), and the backend they call (`livekit-token`, `livekit-webhook`, `go_live`, `end_live`, `send_chat_message`, `room_moderate`, PK battle RPCs). Party rooms only where they share code.
**Compared with:** Bigo Live, Tango, TikTok LIVE, Poppo and Chamet, for a mostly Android audience in Pakistan.

**Checks run:** `npm run typecheck` passed, `npm run lint` passed (no warnings). Tests were not re-run: no tests cover these screens (`src/app/__tests__/` is empty). Known items from `docs/REMAINING_WORK.md`, `docs/reports/APP_ANALYSIS.md` and `docs/reports/SECURITY_AUDIT.md` are marked **Known**.

---

## Summary for the owner

The basics work. A host can go live with a cover, title and category, and can flip the camera before starting. Viewers can watch, chat, send gifts, follow the host and see PK battles. The host sees how many diamonds came in, can moderate chat and can end the live, and gets a summary with AI coaching afterwards.

Next to Bigo or TikTok LIVE, three things stand out:

1. **Dead lives.** If the host's phone dies or loses signal after the live has started, the room can stay "live" for as long as any viewer stays. Viewers see "Connecting to the stream…" with no end.
2. **The host has almost no controls during a live.** They can't mute the mic, switch the camera off, flip the camera, see a timer or see who is watching. Nothing keeps the phone screen awake.
3. **The money moments are thin.** Gift icons are emoji. There's no combo sending, no full-screen animation for big gifts, no likes, no "X joined" lines, and no swipe to the next live. These are what make viewers spend in Bigo-style apps.

**Top 10 to build, in order** (full detail in "Build plan" below):
1. End dead lives on the server and show viewers "Host is away" (M)
2. Keep the screen awake, and handle the host's app going to the background (S–M)
3. Bundle of quick fixes: Android chat keyboard, web share links, diamonds counted twice, mirrored back camera, PK invite list (S)
4. Host controls: mic, camera on/off, flip, timer, "reconnecting" and network-quality badges (M)
5. PK fixes: don't restart the video at battle start/end, don't count viewers twice, invite timeout, show the winner (M)
6. Gifting: combo sending, keep the gift panel open, full-screen animations for big gifts (L)
7. Likes (hearts), "X joined" entry lines and system lines in chat (M)
8. Viewer list, top gifters for this live, and a profile card with moderation actions (M)
9. Swipe up/down to the next live (M–L)
10. Pinned announcement, a muted/blocked list with undo, and report reasons (M)

---

## 1. What already works

### Host Live (`src/app/host/live.tsx`) and Go-live setup (`src/app/(tabs)/create.tsx`)
- **Setup:** a full-screen camera preview, front/back **Flip** (the live uses the chosen camera), a required cover picture, a title (80 characters), category chips, and a choice of LIVE / Multi-guest LIVE / Audio LIVE (`create.tsx:220-308`). Camera and mic permission are asked for, with "Open settings" if they were blocked (`create.tsx:186-203`). Go live is disabled while offline. Restricted accounts and suspended hosts see a clear "paused" message.
- **While live:** a LIVE badge with the viewer count (live updates), the title, **diamonds earned this live** (kept after an app restart, `live.tsx:42-56`), **Share** and **End**.
- **End-live safety:** End asks for confirmation. Android Back asks "End your stream?" instead of leaving the live running (`live.tsx:70-77`). The End live button stays on screen even when the video can't connect (`live.tsx:281-286`). If the live is ended somewhere else (another device, or LiveKit closing it), the host goes to the summary (`live.tsx:78-91`).
- **Reconnect:** a dropped connection shows "Connection lost" with Retry. A camera problem shows one alert with **Reconnect**. Offline shows the offline screen.
- **Chat moderation:** long-press a message to mute (10 min), remove (1 h) or block, make the person a room admin, translate, or report (`ChatPanel.tsx:194-209`). The server checks every action (`room_moderate`) and the person is removed from the video at once (`livekit-enforce`).
- **PK battles:** invite a live host from a list, cancel the invite, accept or decline an invite, a split screen with a score bar and timer, end the battle early, automatic end when time runs out (with retries) (`live.tsx:102-155, 218-272`).
- **Gift pop-ups** for incoming gifts.
- **Summary** (`host/summary.tsx`): minutes, peak viewers, gift coins, AI coaching (updates live), and Share highlights.

### Viewer Watch (`src/app/live/[roomId].tsx`)
- A Bigo-style top bar: host photo and name, coins this live, a **+ Follow** button, today's top 3 gifters in their frames (tap to open contributions), the viewer count and Close (`:198-233`).
- Video with adaptive quality (LiveKit picks the layer that fits the viewer's connection, `LiveStage.tsx:31-34`).
- Chat with a "Say Hi…" box; tap a name to open the profile; long-press to translate or report. Room admins get the moderation tools.
- **Gift panel:** gift grid, ×1/×10/×99, balance shown, a **Recharge** link, "Need N more coins — Recharge" when short, a notice when the wallet is on hold, and the host's share in %. Gifts can't be charged twice (idempotency key, `GiftSheet.tsx:29-31, 74-92`).
- **More menu:** message the host, share, unfollow, report the live.
- **States:** "This stream has ended" with **similar lives** to watch next (`:181-185`). "You can't join this room" when kicked or blocked, shown the moment it happens (`:83-86, 180`). Reconnect after a dropped connection. When the host comes back live, the stream reconnects by itself (`:66-74`).
- PK battle view with the score bar, timer and both videos side by side.
- Opening your own room sends you to the host screen (`:61-64`), so it can't break your broadcast.

---

## 2. Gaps compared with top live apps

**Must-have** = launch blocker or something users expect on day one. **Should-have** = expected soon after launch. **Nice-to-have** = polish.

### Host Live screen

| Priority | Feature | Today | Notes |
|---|---|---|---|
| Must | **Screen stays awake** while live | Missing | No `expo-keep-awake` anywhere in `src/`. The phone can lock itself mid-live (see bug B2). |
| Must | **Background behaviour** (app minimised, phone call) | Missing | No `AppState` handling. Android stops the camera in the background. Viewers get no "Host is away" message (B1, B2). |
| Must | **Mic mute / camera off** buttons | Missing | Party rooms already have a mic toggle (`party/[roomId].tsx:272`, `PartyStage.tsx:40-44`), so reuse that. |
| Must | **Flip camera during the live** | Missing | Only on the setup screen (`create.tsx:283`). `facing` is fixed when the live screen opens (`live.tsx:28`). |
| Must | **Live timer** (how long you've been live) | Missing | The stream start time is already in `streams.started_at`. |
| Must | **Viewer list** (tap the viewer count) | Missing | The count can't be tapped (`ui.tsx:232-243`). The `viewers` table already records who is in. |
| Must | **Reconnecting / weak network indicator** | Missing | Only a final "Connection lost". LiveKit's connection state and connection quality are not shown. |
| Must | Profile card when tapping a chat name (follow, mute, kick, make admin) | Partial | The host's chat has no `onUserPress` (`live.tsx:276`), so a tap does nothing. Only long-press works. |
| Should | **Top gifters of this live** (ranking strip) | Missing on host | The viewer screen shows *today's* top 3, the host screen shows none. |
| Should | **Pinned message / announcement** | Missing | No column or RPC for it. |
| Should | **Muted/blocked list with Unmute/Unblock** | Missing in the app | `room_moderate` supports `unmute`/`unblock`, but no screen calls them. |
| Should | **Co-host / guest join requests** in a solo live | Missing | Only party rooms have seats and requests (`party/[roomId].tsx:160-201, 311-323`). Reuse `request_seat`/`approve_seat`. |
| Should | **Edit title/cover while live** | Missing | Only before going live. |
| Should | **PK result** (winner banner, short "punishment" round) | Missing | When the battle ends, the bar disappears at once (`end_pk_battle` sets `current_battle_id = null`). The result only goes out as a notification. |
| Should | **PK invite timeout and random match** | Missing | Invites never expire (B10). No "random PK" button. |
| Should | Earnings shown as **diamonds with a PKR estimate** | Partial | Diamonds are shown; PKR isn't. |
| Should | **Better summary**: new followers, top gifters, diamonds (not just coins), total viewers | Partial | Summary has minutes, peak viewers and gift coins only. |
| Nice | **Beauty filters** (smooth, brighten, slim) | Missing | Needs a native video-filter library and a short spike. Big in this market, so treat it as Should after launch. |
| Nice | Stickers, background blur, live goals ("10k diamonds goal"), welcome message | Missing | |
| Nice | Live captions | Missing (Known: `docs/REMAINING_WORK.md` row 12) | |

### Viewer Watch screen

| Priority | Feature | Today | Notes |
|---|---|---|---|
| Must | **"Host is away" / "Host ended" while the video is missing** | Partial | "Ended" works. When the host's video disappears the viewer sees "Connecting to the stream…" forever (`LiveStage.tsx:48-54`). |
| Must | **Gift combo** (tap again to send a streak, "x12" counter) and **gift panel stays open** | Missing | The panel closes after every send (`GiftSheet.tsx:84`), so a streak means reopening it every time. |
| Must | **Full-screen animations for big gifts** | Missing | Gifts are emoji text (`GiftSheet.tsx:121`). Only a small toast exists (`GiftSheet.tsx:196-210`). Needs animation files (Lottie or video) per gift. |
| Must | **Likes / hearts tap** | Missing | Known as a design screen not built (`docs/REMAINING_WORK.md:36`). |
| Must | **Swipe up/down to the next live** | Missing | Leaving and picking again is the only way. `SimilarLives` exists only on the ended screen. |
| Must | **Chat box visible above the keyboard on Android** | Possible bug | See B3. |
| Must | **Share link that works in WhatsApp** | Bug | See B8. |
| Should | **Entry lines** ("Ali joined") and system lines (followed, sent a gift) in chat | Missing | Needs a cheap broadcast channel, not a database row per join. |
| Should | **Top viewers strip for this live** | Partial | Today's top 3 across all lives (`:126`, `p_period: 'day'`). |
| Should | **Request to join as a guest** in a solo live | Missing | Party rooms only. |
| Should | **Emoji / quick-reply bar** in chat ("Hi", "❤️", "MashaAllah") | Missing | |
| Should | **Report with reasons** (nudity, minors, violence, scam) | Partial | Fixed reason "Reported from live room" (`:168`). Google Play expects a clear reporting flow; ask `trust-safety`. |
| Should | **Muted state in chat** ("You're muted for 10 min") | Partial | Viewers only find out when a send fails (B13). |
| Should | **Low-data / audio-only mode** | Missing | Matters on Pakistani mobile data. Adaptive stream helps, but there's no manual choice. |
| Should | **Reconnecting indicator** | Missing | |
| Should | **Low-balance recharge nudge** next to the gift button | Partial | Recharge is inside the gift panel. Top apps show a first-recharge offer. |
| Nice | **First-time hints** (swipe, double-tap to like, tap gift) | Missing | |
| Nice | **Rotation / full-screen** for landscape streams | Missing | App is portrait-only (`app.json:7`), which is fine for phone-camera lives. |
| Nice | Mini-player when opening a profile or DM | Missing | Today the stream keeps playing hidden behind (B18). |
| Nice | VIP badges / levels next to chat names, entry effects for VIPs | Missing | Ask `vip-membership-manager`. |

---

## 3. Bugs and risks found in the code

### High

**B1. A live can stay "live" forever after the host's phone dies or loses signal**
- Evidence: `supabase/functions/livekit-webhook/index.ts:24-42`: when the host leaves, only the viewer count changes. The live ends only on `room_finished` (`:54-62`), which LiveKit sends once the room is *empty*. `supabase/migrations/20261019010000_bug_fixes.sql:56-70` (`end_unconnected_lives`) only ends lives whose host *never* connected. On the viewer side, `src/components/LiveStage.tsx:48-54` shows "Connecting to the stream…" whenever there's no host video.
- What happens: the host is live with 30 viewers. Their battery dies. Those viewers keep the LiveKit room open, so the live stays on Home (sorted by viewers, so near the top). New people tap it and see an endless spinner. It ends only when every viewer has left.
- Fix: record when the host leaves (`streams.host_left_at` from `participant_left` where identity = host, cleared on rejoin). End lives where the host has been gone more than about 2 minutes, using the sweeps that already run on joins and go-live. Close the LiveKit room. On the viewer screen, show "Host is away" after about 5 seconds with no host video.
- Owner: live-streaming-engineer + database-engineer

**B2. Nothing keeps the host's screen awake, and nothing handles the app going to the background**
- Evidence: no `expo-keep-awake`/`useKeepAwake`/`AppState` in `src/` (searched). `app.json:21-36` has no Android foreground service for camera or mic.
- What happens (Likely; normal phone behaviour, not tested on a device): a host who talks without touching the screen hits the phone's auto-lock (often 30 s to 2 min). The app goes to the background, Android stops the camera, and viewers see a frozen picture or the endless spinner from B1. The same happens if the host takes a call or opens WhatsApp. Viewers who watch without touching the screen also get their screen locked.
- Fix: call `useKeepAwake()` on the host and viewer live screens (`expo-keep-awake` is already installed with `expo`; add it with `npx expo install`). On `AppState` background, tell viewers the host is away (B1) and offer "Resume" when the host comes back. A foreground service to keep the mic running is a later step.
- Owner: frontend-mobile-developer + live-streaming-engineer

**B3. On Android the keyboard probably covers the live chat box (Possible, same cause as a bug already fixed in DMs)**
- Evidence: `src/components/ChatPanel.tsx:150` uses `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, so nothing happens on Android. The 0.9.63 fix for DMs says why that fails: "Android draws edge to edge, so the window no longer shrinks for the keyboard" (`src/app/chat/[userId].tsx:127-128`). The live chat sits in an absolutely positioned box at the bottom (`live/[roomId].tsx:289`, `host/live.tsx:274`).
- What happens: a viewer taps "Say Hi…" and the keyboard hides the box, so they type blind. Most users in Pakistan are on Android.
- Fix: lift the chat box by the keyboard height (`Keyboard` events or `useAnimatedKeyboard` from Reanimated) on both platforms, then test on an Android device.
- Owner: frontend-mobile-developer

### Medium

**B4. Starting or ending a PK battle restarts the host's broadcast (and every viewer's video)**
- Evidence: `src/app/host/live.tsx:218-231`: the host's `LiveStage` sits inside `PkBattleStage` during a battle and directly on the screen otherwise. Moving it to a different parent makes React remove it and create it again, and LiveKit disconnects when that happens (`node_modules/@livekit/components-react/dist/room-*.mjs` `useLiveKitRoom`: "disconnecting on unmount"). The viewer screen does the same (`src/app/live/[roomId].tsx:262-284`).
- What happens: when the opponent taps Accept, the host's camera turns off and on again and their viewers see "Connecting…" for a moment. The same happens when the battle ends. If live recording is on, the recording may be cut in two (Possible).
- Fix: keep one `LiveStage` mounted in the same place and change only its size and position for the split layout.
- Owner: live-streaming-engineer

**B5. During a PK battle, each side's viewers are also counted as viewers of the other side**
- Evidence: `src/components/PkBattle.tsx:283` gets a normal *viewer* token for the opponent's room, and `LiveStage.tsx:60-65` joins it. The webhook then adds each of them to the opponent's `viewers` and `viewer_count` (`supabase/migrations/20261019020000_analysis_fixes.sql:145-161`). The host also joins the opponent's room this way.
- What happens: room B's viewer count, peak viewers and place on Home and in the "live" ranking include room A's audience, and the other way round. Host A is listed as a viewer of B. Stats and rankings are inflated.
- Fix: mark PK side connections (for example, token metadata `pk: true`, or a separate identity suffix) and skip them in `internal_viewer_event`.
- Owner: live-streaming-engineer + database-engineer

**B6. The host's diamond counter counts gifts twice after Reconnect**
- Evidence: `src/app/host/live.tsx:49-56`: each load adds up every gift of the live into `earned`. `:93` adds new gifts into `newCoins`. `:96` shows `earned + newCoins`. Reconnect, Retry and offline-retry call `session.reload()` (`:196, 202, 206`), which reloads `earned` but never resets `newCoins`.
- What happens: the host gets 500 diamonds, the connection drops, they tap Reconnect, and the counter shows 1,000. Their real earnings are right, but the number on screen is wrong, which leads to support complaints.
- Fix: reset `newCoins` to 0 when the session reloads, or read the total from `streams` instead of adding it up on the phone. The phone-side sum is also capped at 10,000 gifts (`:52`).
- Owner: frontend-mobile-developer

**B7. A host returning to their live without camera permission gets a dead-end alert**
- Evidence: `src/app/(tabs)/create.tsx:186, 196` skip the permission check when the room is already live (deliberately, so End live stays reachable). `src/app/host/live.tsx:191-198` then shows "Camera or connection problem" with **Reconnect**, which can't help. `host/live.tsx:200-206` has no `permission` state.
- What happens: after reinstalling or turning the camera off in Settings, the host taps "Return to stream" and keeps getting the same alert.
- Fix: check camera and mic permission on the host live screen and show the `permission` state with Allow / Open settings (as `create.tsx` does).
- Owner: frontend-mobile-developer

### Low

- **B8. Share links don't work for most people.** `src/app/host/live.tsx:159` and `src/app/live/[roomId].tsx:156` share `zynalive://live/<id>`. WhatsApp doesn't make that tappable, and people without the app can't open it. `vercel.json:42-44` already serves the app for any path, so `https://zynalive.com/live/<id>` opens the web viewer. Use that, and add Android App Links (`intentFilters` with `autoVerify` in `app.json`) so it opens the app when installed. The profile share has the same problem (`src/app/user/[id].tsx:82`). Owner: frontend-mobile-developer + devops-engineer.
- **B9. The PK invite list includes party rooms, which are always refused.** `src/app/host/live.tsx:118-119` doesn't filter `mode = 'live'`, but `invite_pk_battle` requires it (`20261005040000_round5_fixes.sql`, `v_target.mode <> 'live'`). The host sees "That host isn't live right now." Add `.eq('mode', 'live')`. Owner: frontend-mobile-developer.
- **B10. PK invites never expire.** `invite_pk_battle` sets `current_battle_id` on both rooms with no time limit. If the invited host ignores it, both hosts are blocked from other battles, and the invite card covers part of the invited host's screen (`host/live.tsx:261-272`) until someone taps. Add a 30-second expiry (checked on read and swept). Owner: database-engineer.
- **B11. The back camera is shown mirrored to the host.** `src/components/LiveStage.tsx:56` mirrors whenever `role === 'host'` and ignores `facing`. Text and signs look reversed on the host's screen (viewers see it correctly). Mirror only for the front camera. Owner: frontend-mobile-developer.
- **B12. Chat jumps to the bottom on every new message.** `src/components/ChatPanel.tsx:156` always scrolls to the end, so you can't read back in a busy chat. Only auto-scroll when already near the bottom, with a "New messages" pill otherwise. Owner: frontend-mobile-developer.
- **B13. Muted viewers aren't told they're muted.** `src/app/live/[roomId].tsx:83-86` reacts only to kick/block. A muted viewer types a message and only then sees "You're muted in this room." Show a muted notice and disable the input until the mute ends. Owner: frontend-mobile-developer.
- **B14. A failed follow fails silently.** `src/app/live/[roomId].tsx:151`: the + button comes back with no message. Show a short error. Owner: frontend-mobile-developer.
- **B15. Web viewers may hear nothing until they click (Possible).** `src/components/LiveStage.web.tsx:362-363` plays audio without a "Tap to unmute" button, and browsers block sound that starts without a click. Add LiveKit's start-audio button. Owner: frontend-mobile-developer.
- **B16. Host and viewers see different numbers for the same live.** The host sees diamonds (host share, `host/live.tsx:240-244`). Viewers see total coins (`live/[roomId].tsx:136, 207`). Pick one ("diamonds this live") for both. Owner: ui-ux-designer.
- **B17. An expired PK battle ends only if one of the two hosts' apps is open (Possible).** `endBattleIfExpired` is called only from `host/live.tsx:102-113`. If both hosts are in the background, viewers see "PK 0:00" until a host returns or a live ends. Let viewers' apps (or the server sweep from B1) end expired battles; `end_pk_battle` already allows anyone after `ends_at`. Owner: live-streaming-engineer.
- **B18. Opening a profile or DM from a live keeps the stream playing hidden (Possible).** `router.push` at `live/[roomId].tsx:201, 243, 300` keeps the live screen mounted, so its audio and data keep running behind the new screen. Pause it on blur, or add a mini-player. Owner: frontend-mobile-developer.
- **B19. Heavy publishing for cheap phones (Possible).** The host publishes 1080p plus two lower layers (`LiveStage.tsx:30-34`). On low-end Android and mobile uploads this can heat the phone and drop frames. Consider 720p by default and 1080p only on good phones/networks. Owner: live-streaming-engineer.
- **Known, still open:** chat re-reads the last 60 messages every 15 s per viewer (`ChatPanel.tsx:57`; `docs/REMAINING_WORK.md:34`). The PK timer re-renders the whole live screen every second (`PkBattle.tsx:68-75`; "leaf component for the 1 s PK timer" in `docs/REMAINING_WORK.md:33`). No push notification when a followed host goes live (`docs/REMAINING_WORK.md` row 14).

---

## 4. Screen states (7 states)

✓ handled · ~ partly · ✗ missing · n/a not needed

| Screen | Loading | Success | Error | Empty | Offline | Permission | Disabled |
|---|---|---|---|---|---|---|---|
| Go-live setup `(tabs)/create.tsx` | ✓ | ✓ | ✓ | n/a | ✓ (Go live disabled, `:291`) | ✓ (`:186-203`) | ✓ (`:183-184`) |
| Host live `host/live.tsx` | ✓ | ✓ | ✓ (+ End live always visible) | ✓ "You're not live" | ~ only before connecting (`:206`); no "reconnecting" banner mid-live | ✗ (B7) | ✗ restricted account mid-live shows a generic error |
| Viewer `live/[roomId].tsx` | ✓ (spinner never times out, B1) | ✓ | ✓ | ✓ ended + similar lives | ~ only before the room loads (`:178`); mid-live it shows "connection lost" | n/a | ~ kicked/blocked ✓; muted ✗ (B13) |
| Summary `host/summary.tsx` | ✓ | ✓ | ✓ | ✓ | ✓ | n/a | n/a |

---

## 5. Build plan: top 10 in order

| # | What | Size | Files that change | Owner |
|---|---|---|---|---|
| 1 | **End dead lives and show "Host is away"** (B1, part of B17): record host leave/rejoin from the webhook; sweep lives whose host has been gone more than about 2 min (and expired PK battles) from the existing join/go-live sweeps; close the LiveKit room; viewer overlay after about 5 s without host video. Must-pass SQL tests. | M | `supabase/functions/livekit-webhook/index.ts`, new migration (`streams.host_left_at`, sweep), `supabase/tests/10_must_pass.sql`, `src/components/LiveStage.tsx` + `.web.tsx`, `src/app/live/[roomId].tsx` | live-streaming-engineer + database-engineer |
| 2 | **Keep awake and background handling** (B2): `useKeepAwake` on both live screens; on background, mark the host "away" (feeds item 1) and resume cleanly on return. | S–M | `src/app/host/live.tsx`, `src/app/live/[roomId].tsx`, `package.json` (`npx expo install expo-keep-awake`) | frontend-mobile-developer |
| 3 | **Quick-fix bundle**: Android chat keyboard (B3), https share links + Android App Links (B8), diamonds double count (B6), mirrored back camera (B11), PK list filter (B9), chat auto-scroll (B12), muted notice (B13), follow error (B14), host permission state (B7). | S each, M total | `src/components/ChatPanel.tsx`, `src/app/host/live.tsx`, `src/app/live/[roomId].tsx`, `src/components/LiveStage.tsx`, `app.json` | frontend-mobile-developer (App Links: devops-engineer) |
| 4 | **Host controls**: mic mute, camera off ("camera paused" card for viewers), flip during the live, live timer, "Reconnecting…" banner and a network-quality dot (LiveKit `useConnectionState` / `useConnectionQualityIndicator`). Reuse the party mic toggle. | M | `src/app/host/live.tsx`, `src/components/LiveStage.tsx` + `.web.tsx`, `LiveStage.types.ts` | live-streaming-engineer |
| 5 | **PK fixes**: one mounted `LiveStage` across layouts (B4); don't count PK side connections as viewers (B5); 30 s invite expiry (B10); winner banner for about 10 s after the end; leaf timer component (Known). | M | `src/components/PkBattle.tsx`, `src/app/host/live.tsx`, `src/app/live/[roomId].tsx`, `supabase/functions/livekit-token/index.ts`, new migration (`internal_viewer_event`, invite expiry) | live-streaming-engineer + database-engineer |
| 6 | **Gifting that sells**: the panel stays open after sending; a combo button ("x5… x12") reusing the same flow (each tap is a new idempotency key, server unchanged); grouped toasts per sender; full-screen animations for gifts above a price (asset per gift in `gift_catalog`). Gift artwork brief first. | L | `src/components/GiftSheet.tsx`, new `src/components/GiftAnimation.tsx`, migration (`gift_catalog.animation_url`, `tier`), `docs/ECONOMY.md` | frontend-mobile-developer; artwork: virtual-gift-manager + brand-designer; schema: database-engineer |
| 7 | **Likes and entry lines**: double-tap or a heart button sends floating hearts; "X joined" and "X followed the host" lines in chat. Use Supabase Realtime *broadcast* (no database row per tap or join), rate-limited per user; store only a like total per stream. | M | `src/components/ChatPanel.tsx`, new `src/components/Hearts.tsx`, `src/app/live/[roomId].tsx`, `src/app/host/live.tsx`, small migration (stream like total) | frontend-mobile-developer + backend-developer |
| 8 | **Viewer list, top gifters of this live, profile card**: tap the viewer count for a list (top gifters first); a "this live" ranking strip on both screens; tap any name for a card with Follow, and Mute/Kick/Block/Make admin for staff. | M | new RPCs `live_viewers(room)`, `stream_top_gifters(stream)` (migration + RLS + tests), `src/app/host/live.tsx`, `src/app/live/[roomId].tsx`, new `src/components/UserCard.tsx` | database-engineer + frontend-mobile-developer |
| 9 | **Swipe to the next live**: a vertical pager over the live list (same order as Home), with only the visible room connected to LiveKit and the next cover preloaded. | M–L | `src/app/live/[roomId].tsx` (split into a pager and a `LiveRoomView` component), `src/lib/api-rooms.ts` | frontend-mobile-developer |
| 10 | **Moderation polish**: pinned announcement (host/admin), a muted/blocked list with Unmute/Unblock (RPC already supports it), report reasons for rooms and messages. | M | migration (`rooms.pinned_message`, `set_pinned_message` RPC + tests), `src/components/ChatPanel.tsx`, `src/app/host/live.tsx`, `src/app/live/[roomId].tsx` | database-engineer + frontend-mobile-developer; reasons list: trust-safety |

**Next after the top 10:** co-host / guest join in solo lives (reuse party seats, L, live-streaming-engineer); beauty filters (spike a native filter library first, L, live-streaming-engineer); low-data / audio-only mode (S–M); edit title/cover while live (S); richer summary with diamonds, new followers and top gifters (S); first-time hints (S); web start-audio button (B15, S); 720p default on low-end phones (B19, S); push notification when a followed host goes live (Known, M).

Each item needs `npm run check:duplicates`, `typecheck`, `lint`, `test`, `build:web`, `supabase/tests/run.sh` and `agents` pytest to pass, plus doc updates (ARCHITECTURE, DATABASE, ECONOMY, CHANGELOG), as `AGENTS.md` requires. **QA:** the device-farm end-to-end tests for host go-live→end→summary and viewer join→chat→gift→leave are still missing (Known, `docs/REMAINING_WORK.md:41`). Item 1 and B3 especially need a real Android phone to check (qa-test-engineer).

---

## 6. Owner actions (only you can do these)

- **Apply the three waiting migrations and deploy the functions** (Known): the kick/enforce and "dead live" sweeps on these screens only work once `20261019010000`, `20261019020000` and `20261019030000` are applied and `livekit-webhook`, `livekit-enforce` and `livekit-token` are deployed.
- **Decide gift artwork:** big-gift animations need artwork (Lottie or short video per gift). Approve a budget or a designer brief (virtual-gift-manager + brand-designer).
- **Decide what viewers see on the host pill:** diamonds or coins (B16).
- **Choose the PK rules:** battle length (`pk_battle.duration_seconds`, default 180 s), whether to add a punishment round, and whether to add random matching.
- **Beauty filters:** approve a short technical spike. It may need a paid SDK.
- **Android App Links:** to make `https://zynalive.com/live/...` open the app, the site must serve `/.well-known/assetlinks.json` with the app's signing fingerprint from the EAS/Play console (devops-engineer prepares it; you provide Play Console access).
- **LiveKit Cloud plan:** check that the plan's participant and bandwidth limits cover PK battles (each PK viewer holds two connections, see B5) before running events.
