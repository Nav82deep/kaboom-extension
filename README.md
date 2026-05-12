# Kaboom

A Chrome extension for fast, friction-free screen recording. In-browser trim, a live transcript, and a draw-on-screen annotation layer that works mid-recording. Built as a take-home for Capital Compute Technologies.

> Record, trim, ship. No login, no upload spinner, no separate web app to deploy.

---

## Install (from source)

```bash
npm install
npm run build
```

Then in Chrome:

1. Visit `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and pick the `dist/` folder

Pin Kaboom to the toolbar so the popup is one click away.

## Install (from the packaged zip)

```bash
npm run package          # produces kaboom-extension.zip
```

Unzip `kaboom-extension.zip` somewhere and **Load unpacked** that folder. (Chrome only loads zip files directly inside the Web Store; locally you load the unzipped folder.)

---

## How to use

| Action               | How                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Start recording      | Open the popup → choose source + inputs → **Start recording**. Or press `⌘⇧L` / `Ctrl+Shift+L`. |
| Stop recording       | Click the Chrome "Stop sharing" bar, hit the popup again, or press the same shortcut.            |
| Draw on screen       | Popup → **Draw on screen**, or `⌘⇧K` / `Ctrl+Shift+K`. Works while recording.                    |
| Trim before sharing  | Drag the two dark handles on the timeline → **Apply trim**.                                      |
| Jump via transcript  | Click any transcript line → video seeks to that moment.                                          |
| Download / share     | **Download** saves a `.webm`. **Copy link** copies a local extension URL that opens the player.  |
| Library              | Popup → **Library** (or the header link on the player). Search by name or transcript text.      |

The webcam bubble shows up only if you enable it in the popup. Audio sources (system + mic) are independent toggles.

---

## What's in the box

```
src/
  background/      service worker — lifecycle, shortcuts, message routing
  offscreen/       hidden page — getDisplayMedia + canvas composite + MediaRecorder + Web Speech
  popup/           the popup UI (vanilla TS, no framework)
  content/         the on-screen annotation overlay (Shadow DOM, content script)
  preview/         player + trim + transcript + library (Preact + Tailwind)
  lib/             db (Dexie), typed message bus
public/icons/      icon source + generated PNGs
```

All five extension contexts share one repo and one build. Recordings live in IndexedDB; no server, no cloud account.

---

## Develop

```bash
npm run dev        # vite build --watch
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
```

Vite watches the source and rebuilds `dist/` in place. After a change, click **Reload** on the Kaboom card in `chrome://extensions` to pick up service-worker / manifest edits; the popup and preview reload on their own.

---

## Permissions & privacy

Kaboom asks for `offscreen`, `storage`, `tabs`, `scripting`, `activeTab`, `downloads`, and `notifications`. The host permission is `<all_urls>`, used only to inject the annotation overlay and the floating recording indicator into the active tab.

The first time you record with mic or webcam enabled, Chrome will ask for those permissions through the popup. macOS users: make sure Google Chrome itself has camera and microphone access under System Settings → Privacy & Security; without that, Chrome's own prompt never appears.

Everything stays on your machine. No upload endpoint, no analytics, no telemetry. The Copy link button generates a `chrome-extension://…` URL that only works inside the same browser profile that recorded the video.

---

## Why "Kaboom"?

Rhymes with Loom, sounds like an explosion. Recording shouldn't feel like a process, it should feel like clicking a button and being done.
