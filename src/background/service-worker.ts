import type { Message, RecordingConfig } from '../lib/messages';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const SESSION_KEY = 'kaboom_state_v1';

interface State {
  recording: boolean;
  annotation: boolean;
  startedAt: number | null;
  config: RecordingConfig | null;
  targetTabId: number | null;
}

const state: State = {
  recording: false,
  annotation: false,
  startedAt: null,
  config: null,
  targetTabId: null,
};

async function persistState(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        recording: state.recording,
        annotation: state.annotation,
        startedAt: state.startedAt,
        config: state.config,
        targetTabId: state.targetTabId,
      },
    });
  } catch {}
}

async function rehydrateState(): Promise<void> {
  try {
    const obj = await chrome.storage.session.get(SESSION_KEY);
    const s = obj?.[SESSION_KEY];
    if (!s) return;
    state.recording = !!s.recording;
    state.annotation = !!s.annotation;
    state.startedAt = s.startedAt ?? null;
    state.config = s.config ?? null;
    state.targetTabId = s.targetTabId ?? null;
    if (state.recording && !(await hasOffscreen())) {
      state.recording = false;
      state.startedAt = null;
      await persistState();
      updateBadge('');
    } else if (state.recording) {
      updateBadge('REC');
    }
  } catch {}
}

void rehydrateState();

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: 'Composite screen and webcam streams into a single recording.',
  });
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
}

async function startRecording(config: RecordingConfig): Promise<void> {
  if (state.recording) return;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.targetTabId = activeTab?.id ?? null;
  state.config = config;

  await persistState();
  await ensureOffscreen();
  updateBadge('REC');
}

async function stopRecording(): Promise<void> {
  if (!state.recording && !(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' } satisfies Message);
}

function updateBadge(text: string): void {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text ? '#ff4e2c' : '#00000000' });
}

function notify(title: string, message: string): void {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: 1,
    });
  } catch {}
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content.js'],
    });
    return true;
  } catch {
    return false;
  }
}

async function toggleAnnotation(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;
  state.annotation = !state.annotation;
  await persistState();
  await ensureContentScript(activeTab.id);
  chrome.tabs.sendMessage(activeTab.id, {
    type: 'CONTENT_TOGGLE_ANNOTATION',
    active: state.annotation,
  } satisfies Message);
}

function isInjectable(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('edge://') || url.startsWith('about:')) return false;
  if (url.startsWith('https://chrome.google.com/webstore')) return false;
  return true;
}

async function pushStateToTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isInjectable(tab.url)) return;
  const ok = await ensureContentScript(tabId);
  if (!ok) return;
  chrome.tabs.sendMessage(tabId, {
    type: 'CONTENT_RECORDING_STATE',
    recording: state.recording,
    startedAt: state.startedAt,
  } satisfies Message).catch(() => {});
}

async function broadcastRecordingState(): Promise<void> {
  const ids = new Set<number>();
  if (state.targetTabId) ids.add(state.targetTabId);
  const active = await chrome.tabs.query({ active: true });
  for (const t of active) if (t.id) ids.add(t.id);
  await Promise.all([...ids].map(pushStateToTab));
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'POPUP_START':
        await startRecording(msg.config);
        sendResponse({ ok: true });
        return;
      case 'POPUP_STOP':
        await stopRecording();
        sendResponse({ ok: true });
        return;
      case 'POPUP_STATUS_REQUEST':
        await rehydrateState();
        sendResponse({
          type: 'STATUS',
          recording: state.recording,
          annotation: state.annotation,
          startedAt: state.startedAt,
        });
        return;
      case 'POPUP_TOGGLE_ANNOTATION':
        await toggleAnnotation();
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_READY':
        if (state.config) {
          chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', config: state.config } satisfies Message);
        }
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_STARTED':
        state.recording = true;
        state.startedAt = Date.now();
        await persistState();
        broadcastRecordingState();
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_STOPPED':
        state.recording = false;
        state.startedAt = null;
        await persistState();
        updateBadge('');
        broadcastRecordingState();
        await closeOffscreen();
        chrome.tabs.create({
          url: chrome.runtime.getURL(`src/preview/preview.html?id=${msg.recordingId}`),
        });
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_ERROR':
        state.recording = false;
        state.startedAt = null;
        await persistState();
        updateBadge('');
        broadcastRecordingState();
        await closeOffscreen();
        notify('Kaboom — recording failed', msg.message);
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_WARNING':
        notify('Kaboom', msg.message);
        sendResponse({ ok: true });
        return;
      case 'CONTENT_STOP_RECORDING':
        await stopRecording();
        sendResponse({ ok: true });
        return;
      case 'CONTENT_ANNOTATION_CHANGED':
        state.annotation = msg.active;
        await persistState();
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: true });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-recording') {
    if (state.recording) {
      await stopRecording();
    } else {
      await startRecording({
        source: 'desktop',
        withCam: false,
        withMic: true,
        withSystemAudio: true,
      });
    }
  } else if (command === 'toggle-annotation') {
    await toggleAnnotation();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  updateBadge('');
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!state.recording) return;
  pushStateToTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!state.recording) return;
  if (info.status !== 'complete') return;
  pushStateToTab(tabId);
});
