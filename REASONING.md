# Kaboom — Why and How

**Take-home for Capital Compute Technologies**
**Author: Navdeep**
**Time spent: ~2 days**

---

## What I built

A Chrome extension that records your screen.

You click record. You pick a screen or a window. You talk through it. You hit stop. A preview page opens right away with the video on it. On the right side, you see a live transcript with clickable timestamps. Below the video, there is a slider with two handles. You drag the handles to cut out the dead air at the start or end. You hit Apply. The file gets shorter.

While recording, you can press Ctrl+Shift+K to bring up a drawing pen. The strokes end up in the final video.

Nothing leaves your machine. No signup. No cloud upload. No waiting. The file is saved in the browser. You can download it whenever you want.

---

## Why I built it this way

The brief asks for "a Loom-like extension with better UX" in two days. Loom already has trim, transcripts, drawing, comments, team libraries, sharing pages, analytics, a paid tier. I can't beat them on feature count in two days, and trying to do that would have produced a worse version of every one of those features.

So I went the other way: smaller, cleaner, local-only, no signup. The whole thing is one Chrome extension you load in 30 seconds. The popup has nine controls. The preview tab has the player, a slider, and a transcript. There is no account, no sharing page, no paid plan, no upsell. Recordings live on your machine until you decide to do something with them.

The features I did ship are the ones I'd reach for first in a recorder:

1. **Trim before sharing.** Drag two handles on the timeline. Hit Apply. The file gets shorter.
2. **Live transcript.** Chrome's built-in speech-to-text. Click any line and the video jumps to that moment.
3. **Draw on screen while recording.** Pen, highlighter, arrow, eraser, six colors. The strokes are captured in the video because they are part of what's on screen.

Loom does all three of these. The "better UX" I'm betting on isn't a feature they don't have. It's that I don't have all the things they layer on top: a web app, a sign-up flow, a team product, a sharing graph, a billing tier. Less to learn, less to break, less to trust.

In one sentence: a clean local-first screen recorder. Fewer features on purpose.

---

## What I didn't build, and why

- **Accounts and login.** Adds setup and friction. Privacy-first is a feature.
- **Cloud upload and public share URLs.** Needs a server to deploy. Can be added later as a button.
- **Video compression.** Helps long recordings, but adds 250 KB of code and slows things down. Not worth it for clips under 5 minutes.
- **Team workspaces, comments, view counts.** Nice for paid products. Only worth it once the core flow is solid.
- **Pause and resume.** MediaRecorder supports it. I just ran out of time.

Rule I followed: if it doesn't make the recording you just made better, cut it.

---

## How it's actually built

No backend. Plain TypeScript, built with Vite. Recordings are saved in the browser's local database (IndexedDB), with a small helper called Dexie.

There are five separate pieces inside the extension. They talk to each other through Chrome's built-in messaging.

1. **Popup** (`src/popup/`). The small box that appears when you click the toolbar icon. It picks the source, asks for permissions, and starts the recording.
2. **Service worker** (`src/background/`). The brain. It listens for messages from the other pieces, tracks state, and opens the preview tab when recording ends.
3. **Offscreen document** (`src/offscreen/`). A hidden page that does the actual recording. It calls Chrome's screen-capture API, the camera and mic APIs, and the MediaRecorder API.
4. **Content script** (`src/content/`). Runs inside the active web page. Shows the floating red "Recording" pill at the bottom-left, and runs the drawing overlay.
5. **Preview page** (`src/preview/`). What you see after you hit stop. Player, trim slider, transcript, and a library of past recordings. Built with Preact and Tailwind.

Each recording is roughly 5 to 10 MB per minute.

The trickiest bugs I hit were Chrome-specific:

1. Chrome shuts down idle background scripts after about 30 seconds. My first version forgot the state when that happened, so the popup showed "Start recording" in the middle of an active session. I now save the state to `chrome.storage.session` so it survives shutdowns.
2. The function `requestAnimationFrame` doesn't run in hidden pages, which broke my first version of the recording pipeline. Files came out as 0 bytes. I switched to `setInterval`, and to using the screen track directly when no webcam bubble is needed.
3. Chrome injects the content script many times in one session. The first version had top-level variables that crashed on the second injection. I wrapped the whole file in a guard so it only runs once per page.
4. The mic and camera permission prompt was invisible when called from a hidden page. So I moved the ask to the popup, where Chrome shows the prompt right next to the extension icon. Once granted there, the hidden page can use it too.

These were bugs I did not see coming. The docs don't warn you about them, and AI tools confidently get them wrong.

---

## How I used AI

- **Boilerplate.** Vite config, manifest, Tailwind setup. AI drafted these. I fixed mistakes in the output paths and the resource list. Saved a few hours.
- **Trim function.** AI suggested using a byte-slicing approach that doesn't work for browser-recorded video. I switched to a canvas replay approach myself.
- **Cam bubble.** AI wrote the first draft. The math was wrong (it stretched portrait webcams). I rewrote it.
- **Preview UI bits.** AI did the transcript panel, library cards, and share bar. I did the trim slider by hand because that interaction is the whole point.
- **Drawing overlay.** I wrote this from scratch. Shadow DOM, pointer events, arrow math.
- **Chrome-specific bugs.** No AI help. Read Chrome's docs and source code.

Net: AI saved me about a day of typing. I spent that day on the trim slider, the permission flow, the bugs above, and this doc.

---

## Tradeoffs I'd defend

- **One repo with the preview page inside the extension.** Ships as one zip. Reviewer needs no setup. The cost: no sync across devices, no public share URLs.
- **Preact in the preview, plain TypeScript everywhere else.** Popup loads in 5 ms. Full bundle is 86 KB. The cost: two slightly different styles in the same codebase.
- **Canvas-replay trim.** Works on any video the recorder produces. No extra WASM code. The cost: trim takes about real-time (a one-minute trim takes about a minute).
- **Web Speech API for the transcript.** Free, runs in the browser, no API key. The cost: not as accurate as Whisper, and works only in Chrome.
- **IndexedDB only, no cloud.** Private, works offline, instant playback. The cost: no sync.
- **Shadow DOM for the drawing overlay.** The host page's CSS can't break it. The cost: 1 KB of extra inline CSS per page.
- **Asking permission from the popup.** The dialog actually shows up where the user can see it. The cost: one more round-trip before the screen picker shows.

---

## What I'd build next

1. **Pause and resume.** MediaRecorder supports it. Just out of time.
2. **Instant trim for long recordings.** Switch from canvas replay to a WASM video cutter for files that take too long to re-encode.
3. **Optional anonymous share link.** Upload to a free service like file.io behind a button. Keeps the privacy story but gives users a way to share.
4. **Better transcript.** Add Whisper running in the browser (WASM) as a higher-quality option.
5. **Auto-detect silence in the trim view.** Likely the biggest UX win after trim itself.

---

## One line if you ask me what's special about it

A clean local-first screen recorder. Fewer features than Loom, on purpose.
