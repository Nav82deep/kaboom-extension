import type { Message, RecordingConfig } from '../lib/messages';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

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
  await ensureContentScript(activeTab.id);
  chrome.tabs.sendMessage(activeTab.id, {
    type: 'CONTENT_TOGGLE_ANNOTATION',
    active: state.annotation,
  } satisfies Message);
}

async function broadcastRecordingState(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true });
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTENT_RECORDING_STATE',
      recording: state.recording,
      startedAt: state.startedAt,
    } satisfies Message).catch(() => {});
  }
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
        broadcastRecordingState();
        sendResponse({ ok: true });
        return;
      case 'OFFSCREEN_STOPPED':
        state.recording = false;
        state.startedAt = null;
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
        updateBadge('');
        broadcastRecordingState();
        await closeOffscreen();
        sendResponse({ ok: true });
        return;
      case 'CONTENT_STOP_RECORDING':
        await stopRecording();
        sendResponse({ ok: true });
        return;
      case 'CONTENT_ANNOTATION_CHANGED':
        state.annotation = msg.active;
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

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!state.recording) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  await ensureContentScript(tabId);
  chrome.tabs.sendMessage(tabId, {
    type: 'CONTENT_RECORDING_STATE',
    recording: state.recording,
    startedAt: state.startedAt,
  } satisfies Message).catch(() => {});
});
