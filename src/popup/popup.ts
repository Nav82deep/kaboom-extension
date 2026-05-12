import type { RecordingConfig, RecordingSource, Message } from '../lib/messages';
import { send } from '../lib/messages';

const IS_MAC = /mac/i.test(navigator.platform);
const KBD_RECORD = IS_MAC ? '⌘⇧L' : 'Ctrl+Shift+L';
const KBD_DRAW = IS_MAC ? '⌘⇧K' : 'Ctrl+Shift+K';

interface State {
  source: RecordingSource;
  withCam: boolean;
  withMic: boolean;
  withSystemAudio: boolean;
  recording: boolean;
  annotation: boolean;
  startedAt: number | null;
  drawAvailable: boolean;
  activeTabUrl: string;
  permError: { kind: 'cam' | 'mic'; reason: string } | null;
  starting: boolean;
}

const state: State = {
  source: 'desktop',
  withCam: false,
  withMic: true,
  withSystemAudio: true,
  recording: false,
  annotation: false,
  startedAt: null,
  drawAvailable: true,
  activeTabUrl: '',
  permError: null,
  starting: false,
};

interface PreflightResult {
  ok: boolean;
  reason?: string;
}

async function preflight(kind: 'cam' | 'mic'): Promise<PreflightResult> {
  try {
    const constraints: MediaStreamConstraints =
      kind === 'cam'
        ? { video: { width: 320, height: 240 }, audio: false }
        : { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) {
    const err = e as DOMException;
    const reason =
      err.name === 'NotAllowedError'
        ? 'permission_denied'
        : err.name === 'NotFoundError'
          ? 'no_device'
          : err.name === 'NotReadableError'
            ? 'device_in_use'
            : err.message || 'unknown';
    return { ok: false, reason };
  }
}

function reasonLabel(kind: 'cam' | 'mic', reason: string): { title: string; body: string } {
  const device = kind === 'cam' ? 'camera' : 'microphone';
  switch (reason) {
    case 'permission_denied':
      return {
        title: `${cap(device)} access blocked`,
        body: `Chrome won't let Kaboom use your ${device}. Click 'Open settings' to unblock the extension, then try again.`,
      };
    case 'no_device':
      return {
        title: `No ${device} found`,
        body: `No ${device} is connected to this machine.`,
      };
    case 'device_in_use':
      return {
        title: `${cap(device)} is busy`,
        body: `Another app is using your ${device}. Close it (e.g. Zoom, FaceTime) and try again.`,
      };
    default:
      return {
        title: `${cap(device)} unavailable`,
        body: reason,
      };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function openPermissionSettings(kind: 'cam' | 'mic') {
  const url = kind === 'cam' ? 'chrome://settings/content/camera' : 'chrome://settings/content/microphone';
  chrome.tabs.create({ url });
}

function isInjectableUrl(url: string): boolean {
  if (!url) return false;
  return !url.startsWith('chrome://')
    && !url.startsWith('chrome-extension://')
    && !url.startsWith('edge://')
    && !url.startsWith('about:')
    && !url.startsWith('https://chrome.google.com/webstore');
}

const icons = {
  screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 20h8M12 17v3"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>',
  tab: '<svg viewBox="0 0 24 24"><path d="M3 7h6l2 3h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9H5z"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a8 8 0 0 1 0 13"/></svg>',
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function render() {
  const root = document.getElementById('root');
  if (!root) return;

  const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
  const isRec = state.recording;

  root.innerHTML = `
    <div class="brand">
      <h1><span class="logo">K</span>Kaboom</h1>
      <span class="hint ${isRec ? 'timer' : ''}">${isRec ? '● ' + fmt(elapsed) : 'v0.1'}</span>
    </div>

    <div class="section" ${isRec ? 'style="opacity:0.45;pointer-events:none"' : ''}>
      <h2>Source</h2>
      <div class="source-row">
        <button class="source-btn ${state.source === 'desktop' ? 'active' : ''}" data-source="desktop">
          ${icons.screen}<span class="label">Screen</span>
        </button>
        <button class="source-btn ${state.source === 'window' ? 'active' : ''}" data-source="window">
          ${icons.window}<span class="label">Window</span>
        </button>
        <button class="source-btn ${state.source === 'tab' ? 'active' : ''}" data-source="tab">
          ${icons.tab}<span class="label">Tab</span>
        </button>
      </div>
    </div>

    <div class="section" ${isRec ? 'style="opacity:0.45;pointer-events:none"' : ''}>
      <h2>Inputs</h2>
      <div class="toggle-row">
        <label class="toggle">
          <span class="meta">${icons.mic} Microphone</span>
          <input type="checkbox" id="mic" ${state.withMic ? 'checked' : ''} />
          <span class="switch"></span>
        </label>
        <label class="toggle">
          <span class="meta">${icons.cam} Webcam bubble</span>
          <input type="checkbox" id="cam" ${state.withCam ? 'checked' : ''} />
          <span class="switch"></span>
        </label>
        <label class="toggle">
          <span class="meta">${icons.speaker} System audio</span>
          <input type="checkbox" id="sys" ${state.withSystemAudio ? 'checked' : ''} />
          <span class="switch"></span>
        </label>
      </div>
    </div>

    <button class="primary ${isRec ? 'recording' : ''}" id="go" ${state.starting ? 'disabled' : ''}>
      <span class="primary-label">
        ${state.starting
          ? '<span class="spinner"></span> Requesting permission…'
          : isRec
            ? '<span class="dot"></span> Stop recording'
            : 'Start recording'}
      </span>
      ${state.starting ? '' : `<span class="kbd kbd-dark">${KBD_RECORD}</span>`}
    </button>

    ${state.permError ? renderPermError(state.permError) : ''}

    <div class="footer">
      <button class="ghost" id="lib">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
        Library
      </button>
      <button class="ghost ${state.drawAvailable ? '' : 'disabled'}" id="draw" ${state.drawAvailable ? '' : 'aria-disabled="true"'} title="${state.drawAvailable ? '' : 'Open a normal webpage to use the annotation overlay'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        ${state.annotation ? 'Stop drawing' : 'Draw on screen'}
        <span class="kbd">${KBD_DRAW}</span>
      </button>
    </div>
    ${!state.drawAvailable ? '<p class="notice">Drawing works on regular websites — open one in this tab to use the annotation overlay.</p>' : ''}
  `;

  root.querySelectorAll<HTMLElement>('.source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.source = btn.dataset.source as RecordingSource;
      render();
    });
  });

  document.getElementById('mic')?.addEventListener('change', (e) => {
    state.withMic = (e.target as HTMLInputElement).checked;
  });
  document.getElementById('cam')?.addEventListener('change', (e) => {
    state.withCam = (e.target as HTMLInputElement).checked;
  });
  document.getElementById('sys')?.addEventListener('change', (e) => {
    state.withSystemAudio = (e.target as HTMLInputElement).checked;
  });

  document.getElementById('go')?.addEventListener('click', onPrimary);
  document.getElementById('lib')?.addEventListener('click', openLibrary);
  document.getElementById('draw')?.addEventListener('click', async () => {
    if (!state.drawAvailable) return;
    await send({ type: 'POPUP_TOGGLE_ANNOTATION' } satisfies Message);
    window.close();
  });
  document.getElementById('perm-open')?.addEventListener('click', () => {
    if (state.permError) openPermissionSettings(state.permError.kind);
  });
  document.getElementById('perm-skip')?.addEventListener('click', async () => {
    if (!state.permError) return;
    if (state.permError.kind === 'cam') state.withCam = false;
    if (state.permError.kind === 'mic') state.withMic = false;
    state.permError = null;
    render();
  });
  document.getElementById('perm-dismiss')?.addEventListener('click', () => {
    state.permError = null;
    render();
  });
}

function renderPermError(err: { kind: 'cam' | 'mic'; reason: string }): string {
  const { title, body } = reasonLabel(err.kind, err.reason);
  const isPerm = err.reason === 'permission_denied';
  return `
    <div class="perm-error">
      <div class="perm-error-head">
        <span class="perm-error-icon">⚠</span>
        <strong>${title}</strong>
      </div>
      <p>${body}</p>
      <div class="perm-error-actions">
        ${isPerm ? '<button class="btn-perm primary-action" id="perm-open">Open settings</button>' : ''}
        <button class="btn-perm" id="perm-skip">Record without ${err.kind === 'cam' ? 'webcam' : 'mic'}</button>
        <button class="btn-perm ghost-action" id="perm-dismiss">Dismiss</button>
      </div>
    </div>
  `;
}

async function onPrimary() {
  if (state.recording) {
    await send({ type: 'POPUP_STOP' } satisfies Message);
    window.close();
    return;
  }

  state.permError = null;
  state.starting = true;
  render();

  if (state.withCam) {
    const r = await preflight('cam');
    if (!r.ok) {
      state.permError = { kind: 'cam', reason: r.reason ?? 'unknown' };
      state.starting = false;
      render();
      return;
    }
  }
  if (state.withMic) {
    const r = await preflight('mic');
    if (!r.ok) {
      state.permError = { kind: 'mic', reason: r.reason ?? 'unknown' };
      state.starting = false;
      render();
      return;
    }
  }

  const config: RecordingConfig = {
    source: state.source,
    withCam: state.withCam,
    withMic: state.withMic,
    withSystemAudio: state.withSystemAudio,
  };
  await send({ type: 'POPUP_START', config } satisfies Message);
  window.close();
}

function openLibrary() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/preview/preview.html?library=1') });
}

async function refresh() {
  const res = (await send({ type: 'POPUP_STATUS_REQUEST' } satisfies Message)) as unknown;
  if (res && typeof res === 'object' && 'recording' in res) {
    const status = res as { recording: boolean; annotation: boolean; startedAt: number | null };
    state.recording = status.recording;
    state.annotation = status.annotation;
    state.startedAt = status.startedAt;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.activeTabUrl = tab?.url ?? '';
    state.drawAvailable = isInjectableUrl(state.activeTabUrl);
  } catch {
    state.drawAvailable = false;
  }
  render();
}

refresh();
setInterval(refresh, 1000);
