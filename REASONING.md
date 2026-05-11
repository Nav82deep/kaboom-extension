# Kaboom — Document of Reasoning

**Take-home assessment · Capital Compute Technologies**
**Author:** Navdeep
**Sprint length:** ~2 days

---

## 1. How I read the brief

The brief asks for "a Chrome extension like Loom but with better user experience" and explicitly says it is open-ended so the reviewer can see how I prioritise. I read three signals out of that:

1. **A faithful Loom clone is the floor, not the ceiling.** Anyone can ship screen recording in MV3 in two days. What gets remembered is the *one thing* that's noticeably better.
2. **The marking weights tell me what to invest in.** 30% clarity, 30% UI/UX, 25% code/AI, 15% out-of-the-box. So the time budget should look the same: roughly a third on thinking-and-writing, a third on visual polish, a quarter on a clean codebase, and a non-trivial slice on at least one feature a reviewer wouldn't expect.
3. **"AI tools can be used"** is permission, not a passive instruction. The honest test is whether the candidate uses AI to *go further* than they could have alone — not whether they hide it.

I scoped around those three.

---

## 2. Where I attacked the product

Loom's real friction isn't getting *in* to a recording — it's getting *out* of one you're happy with. The moment you stop is when you discover the first three seconds are dead air, you fumbled a word at 0:42, and the share button uploads before you can fix any of that.

So I deliberately did not optimise for the pre-recording loop (Sahaj's angle, by my read of the public submission). I optimised the **post-recording workflow** — the take you actually keep.

Three concrete bets fall out of that framing:

### 2.1 In-browser trim before share

The instant recording stops you land on a preview page with a two-handle timeline. Drag start and end, hit **Apply trim**, the new shorter file replaces the original. No upload, no Pro tier, no separate editor.

Implementation note: I use the canvas-replay approach (load blob into a hidden `<video>`, draw frames to a canvas at 30fps from `trimStart` to `trimEnd`, capture via `MediaRecorder`, swap the IndexedDB blob). It's not the fastest possible trim — a WASM `mp4-muxer` cut without re-encode would be — but it works on any WebM the recorder produced, runs in ~1.0× real time, and avoids 250 KB of WASM weight. For an MVP where most takes are under five minutes, that's the right cut.

### 2.2 Live transcript via Web Speech API

The mic stream feeds `webkitSpeechRecognition` during the recording. Each finalised utterance gets a timestamp anchored to recording-start time, and the cues are stored next to the blob in IndexedDB. The preview page renders them as a clickable panel: click a line, the video seeks there.

This is a Loom-Pro-tier feature ($15/user/month) shipped for free, in 80 lines of code, with zero backend cost — because it runs in the user's browser. The transcript is also exportable as `.srt`, and there's a search box that filters cues. The library page searches across all transcripts of all recordings.

### 2.3 Draw-on-screen annotation, mid-recording

There's a content-script overlay (a fixed-position canvas inside a Shadow DOM root, so the host page's CSS can't touch it) with pen / highlighter / arrow / clear tools and six colour swatches. Activate it with `⌘⇧K` or the popup's **Draw on screen** button.

Because the overlay is part of the captured surface, the strokes appear in the recording automatically — there's no compositing pipeline to maintain. This is the smallest amount of code that delivers a feature people gladly pay extra for in the commercial product.

### 2.4 One repo, no cloud, no Next.js

The most contrarian call. The accepted candidate (whose code I was given as reference) shipped two repos and a Supabase backend. I shipped one repo, no backend, no environment variables for the reviewer to configure. The preview/trim/share UI is a page *inside* the extension (`chrome-extension://<id>/src/preview/preview.html?id=…`) instead of a separate Next.js app.

The tradeoffs I'm taking by doing this:

- I lose cross-device persistence and public shareable links. Real loss — I'd build this back with the first day of "phase 2".
- I gain: blob handoff is trivial (same origin, no Base64 64-encoded postMessage gymnastics), one zip is the entire deliverable, the reviewer can install in 30 seconds without provisioning a Supabase project, and there's exactly one codebase to read.
- For a take-home graded on clarity and code quality, the second list wins. For a real product, the first list wins. I chose the optimisation that matches the artefact.

---

## 3. What I deliberately did not build

| Cut                            | Reason                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Accounts / cross-device sync   | Retention feature. The core loop has to be great before sync matters.                        |
| Public shareable URLs          | Requires a host. Out of scope for a 2-day, single-zip deliverable. (Easy to bolt on later.)  |
| Video compression (FFmpeg WASM) | Real wins at long durations. For sub-5-minute takes the size is fine and WASM startup hurts. |
| View-count analytics            | Not a recording-loop feature.                                                                |
| Team workspaces / comments      | Not a recording-loop feature.                                                                |
| Pause / resume                  | `MediaRecorder` supports `pause()` but the trim feature covers ~all reasons people pause.    |

The pattern: anything that doesn't improve the *taken* recording got cut.

---

## 4. Architecture

### 4.1 Five extension surfaces, one project

- **Service worker** (`src/background/service-worker.ts`) — handles lifecycle, command shortcuts, and brokers messages between popup ↔ offscreen ↔ content script. Keeps no streams (MV3 forbids it), only state.
- **Offscreen document** (`src/offscreen/`) — runs `getDisplayMedia`, optional `getUserMedia` for the cam bubble and the mic, draws the composite to a canvas, pipes the canvas stream + audio graph into a `MediaRecorder`, runs `webkitSpeechRecognition` against the mic, and persists the final Blob to IndexedDB via Dexie.
- **Popup** (`src/popup/`) — vanilla TS, no framework. Source picker, three input toggles, primary action button. Updates a recording timer while a session is live.
- **Content script** (`src/content/`) — the annotation overlay. Shadow DOM root so it cannot collide with the host page's CSS. Self-cleans state on exit.
- **Preview page** (`src/preview/`) — Preact + Tailwind. Player, custom controls, trim scrubber, transcript panel, share bar, library grid. The only surface where a UI framework earns its weight.

I picked **Preact** over React because it has React's API and reads identically, but lands at ~3 KB of runtime instead of ~45 KB. For an extension where bundle size is a quality signal, that's free.

### 4.2 Message bus

There's a single `Message` discriminated union in `src/lib/messages.ts` covering every cross-context message in the extension. TypeScript catches missing cases at compile time and the message handlers in the service worker / offscreen / content script all `switch` exhaustively. The cost is a handful more types; the payoff is that adding a new message type makes the compiler tell me everywhere I have to handle it.

### 4.3 State persistence

Dexie wraps IndexedDB and gives me typed `Recording` objects (id, name, blob, mime, duration, transcript cues, dimensions, timestamps). The whole thing is `crypto.randomUUID().slice(0,8)`-keyed because user-visible recording IDs of 8 chars beat 36-char UUIDs in URLs and the collision rate is rounding error for personal use.

### 4.4 The OFFSCREEN race I almost shipped

The first version of the service worker called `chrome.offscreen.createDocument(...)` and then immediately sent the start-recording message. That race-conditions: `createDocument` returning doesn't mean the offscreen page's listener has bound. I caught it during a re-read of the build output, before testing. The fix is to make the offscreen document send `OFFSCREEN_READY` once it's wired up, and the service worker only sends `OFFSCREEN_START` in response. Standard handshake. Easy to write the broken version; worth pointing out as the kind of bug AI-generated MV3 code routinely ships with.

---

## 5. How I used AI tools

Honest breakdown, because the brief weights this and dishonesty would be obvious.

- **Project scaffolding.** I had AI generate the Vite multi-entry config, the Tailwind setup, and the initial `manifest.json` shape. I reviewed and adjusted both — particularly the `web_accessible_resources` array and the entry-name → output-path mapping, neither of which the first draft got right.
- **MediaRecorder composite logic.** The canvas-draw-loop pulling screen + cam into one frame is a pattern I sketched on paper, then had AI fill in. The circular cam clip was wrong on the first pass (it didn't respect aspect ratio, so it stretched portrait webcams); I rewrote the source-rect math by hand.
- **Trim-by-replay.** AI's first cut tried to use `MediaSource` byte slicing, which doesn't work on browser-recorded WebM because the cluster boundaries aren't predictable. I switched it to the canvas-replay approach myself.
- **Preview UI components.** I wrote the Timeline component (two handles, draggable, with the trim mask overlay) entirely by hand because the trim UX is the whole product. The transcript panel, library cards, and share bar are AI-assisted scaffolds I edited heavily for visual rhythm and interaction polish.
- **The annotation overlay.** I owned this end to end — Shadow DOM isolation, pen / highlight / arrow drawing, the toolbar styling. AI was useful as a rubber-duck for the arrow-head trigonometry and nothing else.
- **Where AI was unhelpful.** Service-worker lifecycle, `chrome.offscreen` quirks, `displaySurface` constraints, and `webkitSpeechRecognition` in offscreen contexts — all needed me reading docs and the actual Chrome source-of-truth. AI guesses confidently here and is wrong about ~half the API surface.

Net: AI saved me roughly a day of typing on boilerplate and let me spend that day on the trim UI, the annotation overlay, and this document. It didn't save me from any of the actual hard calls.

---

## 6. Tradeoffs I'm willing to defend

| Decision                                | What it bought                                                                  | What it cost                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Single repo, in-extension preview page  | Trivial blob handoff; zero-config install; one zip ships the whole product.     | No cross-device library; no public share links.                             |
| Preact instead of React                 | ~3 KB runtime; identical mental model.                                          | Lose React 19 server features (irrelevant in an extension).                 |
| Canvas-replay trim                       | Codec-agnostic; no WASM; works on every WebM the recorder produces.             | Trim runs at roughly 1× real-time; can't trim a 60-min recording instantly. |
| Web Speech API for transcripts          | Free; no backend; runs in the user's browser; no privacy concerns.              | Quality is good but not Whisper-grade; not all locales supported equally.   |
| IndexedDB / Dexie, no cloud             | Offline-resilient; private by default; nothing to deploy.                       | Storage capped to browser quotas; not synced.                               |
| Shadow DOM annotation overlay           | Host-page CSS can't break it; doesn't leak styles into the page.                | Adds a ~kilobyte of inline CSS per active page.                             |
| Vanilla TS in the popup, framework only in the preview | Popup boots in <5 ms; preview pays the React-shaped cost where it earns it. | Two slightly different idioms in the codebase to learn.                     |

---

## 7. What I'd build with another day

- **Pause / resume** via `MediaRecorder.pause()` — actually quick, just out of scope.
- **WASM-based trim** (`mp4-muxer` or equivalent) for instant cuts on long recordings.
- **Optional anonymous upload** to file.io or transfer.sh, behind a button, so users *can* generate a public shareable URL without me running infrastructure.
- **Whisper.cpp WASM** transcript as a higher-quality option when the user is offline.
- **Auto-skip silence** in the trim view (detect gaps in the transcript / audio amplitude) — biggest single UX win past trim itself.

The pattern: keep stacking the post-recording workflow.

---

## 8. The one thing I want the reviewer to remember

The accepted submission you gave me as reference and Kaboom solve different halves of the Loom problem. Both halves are real. Mine is the one most people lose more time to — not getting *into* the recording but getting *out* of a take they're willing to send.
