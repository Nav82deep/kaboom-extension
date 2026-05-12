# Kaboom — Why and How

**Take-home for Capital Compute Technologies**
**Author: Navdeep**
**Time spent: ~2 days**

---

## What I built

A Chrome extension that records your screen.

You click record, pick a screen or window, talk through it, hit stop. The preview tab opens straight away with the video. On the right you get a live transcript with clickable timestamps. Under the player there's a slider with two handles — drag them to trim out the dead air, hit Apply, file gets shorter. During the recording you can press Ctrl+Shift+K to bring up a drawing overlay (pen, highlighter, arrow, colors) and the strokes end up in the final video.

Nothing leaves your machine. There's no signup, no cloud upload, no "wait for it to process". The Blob lives in IndexedDB. You download it when you want to.

---

## Why I built it this way

Loom is fine to use. The friction isn't in starting a recording. It's in everything that happens after you stop.

You fumbled a word. The first three seconds are dead air. You wanted to circle a button mid-explanation. So you either re-record (annoying) or pay for Loom Pro to get trim and annotation tools (expensive).

I focused the whole sprint on fixing that. The three differentiators are:

1. **Trim before sharing** — two drag handles on the timeline, hit Apply, done.
2. **Live transcript** — runs in the browser via the Web Speech API, free, with clickable timestamps. Click any line and the video jumps there.
3. **Draw on screen** — overlay that works mid-recording. The strokes are captured automatically because they're part of what your screen looks like.

The accepted submission I was given as reference (Capital Capture) cut the *pre-recording* friction: no login, instant preview after stop. That's good, and I didn't try to do the same thing again. I picked the other half of the problem.

---

## What I didn't build, and why

- **Login system.** Users hate signups. Adds infrastructure.
- **Cloud upload / public share links.** Would need a server I'd have to deploy. Out of scope for a 2-day single-zip deliverable. Can add later behind a button.
- **Video compression.** Helps long recordings, adds 250KB of WASM, hurts startup. Not worth it for clips under 5 minutes.
- **Team workspaces, comments, view counts.** Retention features. Irrelevant before the core loop is good.
- **Pause/resume.** Easy to add but the trim feature covers most reasons people pause.

Rule I followed: if it doesn't improve the recording you just made, cut it.

---

## How it's actually built

No backend. Plain TypeScript and Vite. There are five separate pieces inside the extension and they talk to each other through Chrome's messaging API.

| Piece | What it does | File |
| --- | --- | --- |
| Popup | The little UI when you click the toolbar icon. Picks source, asks for permissions, kicks off the recording. | `src/popup/` |
| Service worker | The orchestrator. Receives messages, tracks state, opens the preview tab when recording ends. | `src/background/` |
| Offscreen document | Does the actual recording. Calls getDisplayMedia, getUserMedia, runs MediaRecorder. Hidden DOM page. | `src/offscreen/` |
| Content script | Injects two things into the active tab: the floating red "Recording" pill, and the drawing overlay. | `src/content/` |
| Preview page | The post-recording UI. Player, trim, transcript, library. Preact + Tailwind. | `src/preview/` |

Storage is IndexedDB via Dexie. Each recording is around 5-10MB per minute.

The trickiest things I had to figure out were specific to Chrome's MV3 model:

- Service workers get killed after about 30 seconds of inactivity, so I had to mirror recording state to `chrome.storage.session` so the popup doesn't show "Start recording" mid-recording after the worker restarts.
- `requestAnimationFrame` doesn't fire in hidden offscreen documents, which meant my first version of the canvas-composite produced 0-byte recordings. Switched to `setInterval`.
- Content scripts get injected multiple times during a session (on every tab switch). The first version had top-level `const` declarations that crashed on the second injection. Wrapped everything in a guarded IIFE.
- The mic/camera permission prompt was invisible to the user when I called `getUserMedia` from the offscreen doc. Moved the request to the popup where Chrome's dialog actually anchors to the extension icon. Once granted there, the offscreen doc inherits the permission.

These weren't bugs I expected. They're the kind of thing the docs don't tell you and AI tools confidently get wrong.

---

## How I used AI

Honestly:

- **Boilerplate** (Vite config, manifest, Tailwind setup, the initial scaffold): AI drafted, I fixed mistakes in the entry-name to output-path mapping and the web_accessible_resources array. Saved a few hours.
- **Trim function**: AI suggested MediaSource byte slicing, which doesn't work on browser-recorded WebM. I switched to a canvas-replay approach myself.
- **Cam bubble composite**: AI scaffolded, the aspect-ratio math was wrong (it stretched portrait webcams), I rewrote it.
- **UI components in the preview**: AI scaffolded transcript panel, library cards, and share bar. I did the trim Timeline component by hand because that interaction is the whole product.
- **Drawing overlay**: I owned this end to end. Shadow DOM, pointer events, arrow trigonometry.
- **MV3 quirks** (the ones above): no AI help. Read Chromium docs and source.

Net: AI saved roughly a day of typing. That day went into the trim UI, the permission preflight flow, debugging the MV3 quirks, and writing this doc.

---

## Tradeoffs I'd defend

| What I chose | What I got | What it cost |
| --- | --- | --- |
| One repo, preview inside the extension | One zip ships everything. No env vars for the reviewer to configure. | No cross-device sync. No public share URLs. |
| Preact in preview, vanilla TS everywhere else | Popup boots in 5ms. Bundle is 86KB. | Two idioms in the same codebase. |
| Canvas-replay trim | Works on any WebM the recorder produces. No WASM. | Trim takes about 1x real-time. |
| Web Speech API for transcripts | Free, runs in-browser, no API key | Not Whisper-accurate. Chrome-only. |
| IndexedDB local-only | Private, offline-friendly, instant playback. | No sync, no sharing across devices. |
| Shadow DOM annotation overlay | Host page CSS can't break it. | 1KB of inline CSS per active tab. |
| Permission preflight from the popup | Permission prompt actually appears anchored to the extension icon. | Extra round-trip before the screen picker. |

---

## What I'd build next

1. **Pause/resume** — MediaRecorder supports it, just out of scope.
2. **Instant trim for long recordings** — switch from canvas-replay to WASM mp4-muxer for files where re-encoding is too slow.
3. **Optional anonymous share link** — file.io or transfer.sh upload behind a button. Keeps the privacy-by-default story but gives users an out.
4. **Better transcript** — Whisper.cpp WASM as a higher-quality alternative to Web Speech.
5. **Auto-detect silence** in the trim view — biggest UX win after the trim feature itself.

---

## One line if you ask me what's special about it

Record your screen, trim it, share it, without leaving the browser.
