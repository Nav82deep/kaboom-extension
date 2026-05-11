export type RecordingSource = 'tab' | 'desktop' | 'window';

export interface RecordingConfig {
  source: RecordingSource;
  withCam: boolean;
  withMic: boolean;
  withSystemAudio: boolean;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export type Message =
  | { type: 'POPUP_START'; config: RecordingConfig }
  | { type: 'POPUP_STOP' }
  | { type: 'POPUP_STATUS_REQUEST' }
  | { type: 'POPUP_TOGGLE_ANNOTATION' }
  | { type: 'OFFSCREEN_READY' }
  | { type: 'OFFSCREEN_START'; config: RecordingConfig }
  | { type: 'OFFSCREEN_STOP' }
  | { type: 'OFFSCREEN_STARTED' }
  | { type: 'OFFSCREEN_STOPPED'; recordingId: string }
  | { type: 'OFFSCREEN_ERROR'; message: string }
  | { type: 'OFFSCREEN_TRANSCRIPT'; cue: TranscriptCue }
  | { type: 'STATUS'; recording: boolean; annotation: boolean; startedAt: number | null }
  | { type: 'CONTENT_TOGGLE_ANNOTATION'; active: boolean }
  | { type: 'CONTENT_ANNOTATION_CHANGED'; active: boolean }
  | { type: 'CONTENT_RECORDING_STATE'; recording: boolean; startedAt: number | null }
  | { type: 'CONTENT_STOP_RECORDING' };

export type MessageResponse = void | { ok: true } | { ok: false; error: string };

export function send<T extends Message>(msg: T): Promise<MessageResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? 'unknown' });
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}

export function sendToTab<T extends Message>(tabId: number, msg: T): Promise<MessageResponse> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? 'unknown' });
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}
