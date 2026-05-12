# Kaboom — Document of Reasoning

**Take-home assessment · Capital Compute Technologies**
**Author:** Navdeep
**Sprint length:** ~2 days

---

## 1. How I read the brief

The brief asks for "a Chrome extension like Loom but with better user experience" and explicitly says it's open-ended so the reviewer can see how I prioritise. Three things stood out to me:

A faithful Loom clone is the floor, not the ceiling. Anyone can ship screen recording in MV3 in two days. What actually gets remembered is the one thing that's noticeably better.

The marking weights tell me where to spend time. 30% clarity, 30% UI/UX, 25% code/AI, 15% out-of-the-box. My time budget mirrored that: a chunk on thinking and writing, a chunk on visual polish, a quarter on a clean codebase, and a non-trivial slice on at least one feature a reviewer wouldn't expect.

"AI tools can be used" reads as permission, not as a passive instruction. Used well, it's a force multiplier. I tried to use it that way and to be honest about where it helped and where it didn't.

---

## 2. Where I attacked the product

Loom's real friction isn't getting *in* to a recording. It's getting *out* of one you're happy with. The moment you stop is when you notice the first three seconds are dead air, you fumbled a word at 0:42, and the share button uploads before you can fix any of that.

So I deliberately did not optimise for the pre-recording loop. I optimised the post-recording workflow, the take you actually keep.

### 2.1 In-browser trim before share

The moment recording stops, you land on a preview page with a two-handle timeline. Drag start and end, hit Apply trim, the new shorter file replaces the original. No upload, no Pro tier, no separate editor.

Implementation note: I use the canvas-replay approach. Load blob into a hidden `<video>`, draw frames to a canvas at 30 fps from `trimStart` to `trimEnd`, capture via `MediaRecorder`, swap the IndexedDB blob. Not the fastest possible (a WASM `mp4-muxer` cut without re-encode would be), but it works on any WebM the recorder produced, runs at roughly real time, and avoids 250 KB of WASM weight. For an MVP where most takes are under five minutes, that's the right tradeoff.

### 2.2 Live transcript via Web Speech API

The mic stream feeds `webkitSpeechRecognition` during the recording. Each finalised utterance is timestamped against recording-start, and the cues are stored next to the blob in IndexedDB. The preview page renders them as a clickable panel; click a line, the video seeks there.

This is a Loom-Pro-tier feature ($15/user/month) shipped for free, in about 80 lines, with zero backend cost, because it runs in the browser. The transcript is exportable as `.srt`, there's a search box that filters cues, and the library page searches across transcripts of all recordings.

### 2.3 Draw-on-screen annotation, mid-recording

A content-script overlay (a fixed-position canvas inside a Shadow DOM root, so the host page's CSS can't reach it) with pen, highlighter, arrow, and clear tools and six colour swatches. Activate with `⌘⇧K` (or `Ctrl+Shift+K`) or the popup's Draw on screen button.

Because the overlay sits on the captured surface, the strokes appear in the recording automatically. There's no compositing pipeline to maintain. Smallest amount of code that delivers a feature people pay extra for in the commercial product.

### 2.4 One repo, no cloud, no Next.js

The most contrarian call. The accepted submission I was given as reference shipped two repos and a Supabase backend. I shipped one repo, no backend, no environment variables for the reviewer to configure. The preview/trim/share UI is a page inside the extension (`chrome-extension://<id>/src/preview/preview.html?id=…`) rather than a separate Next.js app.

What I'm sacrificing: cross-device persistence and public shareable links. Real loss, would build it back in phase 2.

What I'm gaining: blob handoff is trivial (same origin, no Base64 postMessage gymnastics), one zip is the entire deliverable, the reviewer installs in 30 seconds with no Supabase project to provision, and there's exactly one codebase to read.

For a take-home graded on clarity and code quality, the second list wins. For a real product, the first list wins. I chose the optimisation that matches the artefact.

---

## 3. What I deliberately did not build

| Cut                            | Reason                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Accounts / cross-device sync   | Retention feature. The core loop has to be great first.                                      |
| Public shareable URLs          | Requires a host. Out of scope for a 2-day, single-zip deliverable.                            |
| Video compression (FFmpeg WASM) | Real wins at long durations. For sub-5-minute takes, the size is fine and WASM startup hurts. |
| View-count analytics            | Not a recording-loop feature.                                                                |
| Team workspaces / comments      | Not a recording-loop feature.                                                                |
| Pause / resume                  | `MediaRecorder.pause()` exists, but trim covers most reasons people pause.                   |

The pattern: anything that doesn't improve the taken recording got cut.

---

## 4. Architecture

### 4.1 Five extension surfaces, one project

- **Service worker** (`src/background/service-worker.ts`). Lifecycle, command shortcuts, message routing between popup, offscreen, and content script. Keeps no streams (MV3 forbids it), only state.
- **Offscreen document** (`src/offscreen/`). Runs `getDisplayMedia`, optional `getUserMedia` for cam bubble and mic, optionally draws screen+cam to a canvas, pipes the canvas stream plus audio graph into a `MediaRecorder`, runs `webkitSpeechRecognition` against the mic, persists the final Blob to IndexedDB via Dexie.
- **Popup** (`src/popup/`). Vanilla TS, no framework. Source picker, three input toggles, primary action button. Preflights camera and microphone permissions before launching the offscreen recorder (more on this below).
- **Content script** (`src/content/`). Two things: the annotation overlay and the floating bottom-left recording indicator with timer and Stop button. Shadow DOM root so it can't collide with the host page's CSS.
- **Preview page** (`src/preview/`). Preact + Tailwind. Player, custom controls, trim scrubber, transcript panel, share bar, library grid. The only surface where a UI framework earns its weight.

Preact instead of React because Preact's API reads identically but lands at ~3 KB of runtime instead of ~45 KB. For an extension where bundle size is a quality signal, that's free.

### 4.2 Message bus

A single `Message` discriminated union in `src/lib/messages.ts` covers every cross-context message. TypeScript catches missing cases at compile time and the handlers all `switch` exhaustively. The cost is a handful more types; the payoff is that adding a message type makes the compiler tell me everywhere I have to handle it.

### 4.3 State persistence across SW death

MV3 suspends idle service workers every ~30 seconds. The first version of this extension kept `state.recording` in module memory, and the popup would show "Start recording" 30 seconds into a session because the SW had restarted and forgotten. I now mirror state to `chrome.storage.session` on every change and rehydrate on every SW startup and on every status query from the popup. The offscreen document is the actual source of truth (if it exists, recording is in progress); the session storage is the canonical record of when it started.

### 4.4 The offscreen-doc rendering gotcha

Hidden offscreen documents throttle (or stop) `requestAnimationFrame`. My first canvas-composite pipeline used rAF, which meant zero frames got drawn, the captureStream got no data, and `MediaRecorder` produced 0-byte blobs every time. Took an embarrassing amount of time to diagnose.

Two-part fix. When the webcam bubble is off (the default), skip the canvas entirely and pipe the screen's own video track straight into `MediaRecorder`. When the bubble is on, keep the canvas composite but drive it with `setInterval(33ms)`, which isn't throttled the same way rAF is.

### 4.5 Permission preflight from the popup

Calling `getUserMedia` from inside a hidden offscreen document is technically allowed by MV3, but Chrome's permission prompt either lands somewhere the user doesn't see or gets stolen by the screen-picker gesture flow. So the webcam bubble was silently failing for anyone whose extension hadn't been pre-granted.

The fix was to preflight from the popup. When the user clicks Start with cam or mic on, the popup itself calls `getUserMedia` first. Chrome's permission dialog now lands anchored to the extension icon at the top of the browser, where the user can actually see it. Once granted, the offscreen doc inherits the grant via same-origin permission storage.

### 4.6 Content script idempotency

The SW calls `chrome.scripting.executeScript` to inject the content script multiple times during a single recording: once when the recording starts, once when the user switches tabs, once on each tab update. Chrome re-executes the script body in the same isolated world each time, so any top-level `const` declarations would collide on the second injection. I wrap the entire content-script body in a guarded IIFE that returns early if `window.__kaboomOverlayInit` is true. Zero top-level identifiers, zero collisions.

---

## 5. How I used AI tools

I used AI throughout. Here's where it helped and where it didn't.

- **Project scaffolding.** Vite multi-entry config, Tailwind setup, the initial `manifest.json` shape. Saved several hours of typing. I had to fix the `web_accessible_resources` array and the entry-name to output-path mapping; neither was right on the first pass.
- **MediaRecorder composite logic.** The canvas-draw-loop pulling screen + cam into one frame is a pattern I sketched on paper and had AI fill in. The circular cam clip was wrong on the first pass (it stretched portrait webcams because the source-rect math didn't respect aspect ratio); I rewrote it.
- **Trim-by-replay.** AI's first cut tried `MediaSource` byte slicing, which doesn't work on browser-recorded WebM because cluster boundaries aren't predictable. I switched it to the canvas-replay approach.
- **Preview UI components.** I wrote the Timeline component (two handles, draggable, with the trim mask overlay) by hand because the trim UX *is* the product. The transcript panel, library cards, and share bar started as AI-assisted scaffolds I then edited for visual rhythm and interaction polish.
- **The annotation overlay.** I owned this end to end: Shadow DOM isolation, pen/highlight/arrow drawing, toolbar styling. AI helped with the arrow-head trigonometry and nothing else.
- **Where AI was unhelpful.** Service worker lifecycle, `chrome.offscreen` quirks, the rAF-in-offscreen-docs trap, `displaySurface` constraints, and `webkitSpeechRecognition` behaviour in offscreen contexts. All needed me reading Chromium docs and source. AI guesses confidently here and is wrong about half the API surface.

Net: AI saved me roughly a day of boilerplate typing, which I spent on the trim UI, the annotation overlay, the permission preflight flow, and this document. It didn't save me from any of the actual hard calls.

---

## 6. Tradeoffs I can defend

| Decision                                | Bought                                                                          | Cost                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Single repo, in-extension preview page  | Trivial blob handoff. Zero-config install. One zip ships the whole product.     | No cross-device library. No public share links.                     |
| Preact instead of React                 | ~3 KB runtime. Identical mental model.                                          | Lose React 19 server features. Irrelevant in an extension.          |
| Canvas-replay trim                       | Codec-agnostic. No WASM. Works on every WebM the recorder produces.             | Trim runs at roughly real time. Can't trim a 60-minute file instantly. |
| Web Speech API for transcripts          | Free. No backend. Runs in the user's browser. No privacy concerns.              | Quality is good but not Whisper-grade. Not every locale supported equally. |
| IndexedDB / Dexie, no cloud             | Offline-resilient. Private by default. Nothing to deploy.                        | Storage capped to browser quotas. No sync.                          |
| Shadow DOM annotation overlay           | Host-page CSS can't break it. Doesn't leak styles into the page.                | Adds a kilobyte of inline CSS per active page.                      |
| Vanilla TS in popup, Preact only in preview | Popup boots in <5 ms. Preview pays the framework cost where it earns it.   | Two slightly different idioms in the codebase.                       |
| Permission preflight from the popup     | Chrome's dialog actually appears where the user can see it. Cam bubble works.   | An extra round-trip before recording starts.                        |

---

## 7. What I'd build with another day

- Pause/resume via `MediaRecorder.pause()`. Quick win, just out of scope.
- WASM-based trim (`mp4-muxer` or equivalent) for instant cuts on long recordings.
- Optional anonymous upload to file.io or transfer.sh, behind a button, so users *can* generate a public shareable URL without me running infrastructure.
- Whisper.cpp WASM transcript as a higher-quality option, with Web Speech as the fallback for low-resource machines.
- Auto-skip silence in the trim view, detected from amplitude or gaps in the transcript. Probably the biggest single UX win past trim itself.

The pattern: keep stacking the post-recording workflow.

---

## 8. The one thing I want the reviewer to remember

The accepted submission you gave me and Kaboom solve different halves of the Loom problem. Both halves are real. Mine is the one most people lose more time to: not getting *into* the recording, but getting *out* of a take they're willing to send.
