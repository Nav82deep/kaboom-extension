import type { Message, RecordingConfig, TranscriptCue } from '../lib/messages';
import { saveRecording } from '../lib/db';

interface Session {
  screen: MediaStream;
  cam: MediaStream | null;
  mic: MediaStream | null;
  combined: MediaStream;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  startedAt: number;
  width: number;
  height: number;
  mimeType: string;
  rafId: number | null;
  recognizer: SpeechRecognition | null;
  transcript: TranscriptCue[];
  partialStart: number | null;
}

let session: Session | null = null;

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function getScreen(config: RecordingConfig): Promise<MediaStream> {
  const surfaceMap: Record<string, string> = {
    tab: 'browser',
    window: 'window',
    desktop: 'monitor',
  };
  const videoConstraints: MediaTrackConstraints & { displaySurface?: string } = {
    frameRate: 30,
    displaySurface: surfaceMap[config.source] ?? 'monitor',
  };
  const constraints: DisplayMediaStreamOptions = {
    video: videoConstraints,
    audio: config.withSystemAudio,
  };
  return navigator.mediaDevices.getDisplayMedia(constraints);
}

async function getCam(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });
  } catch {
    return null;
  }
}

async function getMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    return null;
  }
}

function drawComposite(s: Session, canvas: HTMLCanvasElement, screenEl: HTMLVideoElement, camEl: HTMLVideoElement | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const render = () => {
    if (!session) return;
    ctx.drawImage(screenEl, 0, 0, canvas.width, canvas.height);
    if (camEl && camEl.readyState >= 2) {
      const camSize = Math.round(canvas.height * 0.18);
      const pad = Math.round(canvas.height * 0.025);
      const cx = canvas.width - camSize - pad;
      const cy = canvas.height - camSize - pad;
      const r = camSize / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + r, cy + r, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const camAspect = camEl.videoWidth / camEl.videoHeight;
      let sw = camEl.videoWidth;
      let sh = camEl.videoHeight;
      if (camAspect > 1) {
        sw = camEl.videoHeight;
      } else {
        sh = camEl.videoWidth;
      }
      const sx = (camEl.videoWidth - sw) / 2;
      const sy = (camEl.videoHeight - sh) / 2;
      ctx.drawImage(camEl, sx, sy, sw, sh, cx, cy, camSize, camSize);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx + r, cy + r, r + 1, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r, cy + r, r + 3, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(15,16,20,0.15)';
      ctx.stroke();
    }
    s.rafId = requestAnimationFrame(render);
  };
  s.rafId = requestAnimationFrame(render);
}

function startRecognition(s: Session): void {
  const Ctor =
    (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
  if (!Ctor) return;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';

  r.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) {
        if (s.partialStart === null) s.partialStart = Date.now() - s.startedAt;
        continue;
      }
      const text = result[0].transcript.trim();
      if (!text) {
        s.partialStart = null;
        continue;
      }
      const end = Date.now() - s.startedAt;
      const start = s.partialStart ?? Math.max(0, end - 3000);
      const cue: TranscriptCue = { start, end, text };
      s.transcript.push(cue);
      s.partialStart = null;
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_TRANSCRIPT', cue } satisfies Message);
    }
  };

  r.onerror = () => {};
  r.onend = () => {
    if (session === s) {
      try {
        r.start();
      } catch {}
    }
  };

  try {
    r.start();
    s.recognizer = r;
  } catch {
    s.recognizer = null;
  }
}

async function startSession(config: RecordingConfig): Promise<void> {
  if (session) return;

  const screen = await getScreen(config);
  const cam = config.withCam ? await getCam() : null;
  const mic = config.withMic ? await getMic() : null;

  const screenTrack = screen.getVideoTracks()[0];
  const screenSettings = screenTrack.getSettings();
  const width = screenSettings.width ?? 1920;
  const height = screenSettings.height ?? 1080;

  const screenEl = document.getElementById('screenVideo') as HTMLVideoElement;
  const camEl = document.getElementById('camVideo') as HTMLVideoElement | null;
  const canvas = document.getElementById('composite') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;

  screenEl.srcObject = screen;
  await screenEl.play();
  if (cam && camEl) {
    camEl.srcObject = cam;
    await camEl.play();
  }

  const canvasStream = canvas.captureStream(30);
  const audioContext = new AudioContext();
  const dest = audioContext.createMediaStreamDestination();
  let anyAudio = false;
  for (const stream of [screen, mic]) {
    if (stream && stream.getAudioTracks().length) {
      const node = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      node.connect(dest);
      anyAudio = true;
    }
  }
  const combined = new MediaStream();
  for (const t of canvasStream.getVideoTracks()) combined.addTrack(t);
  if (anyAudio) {
    for (const t of dest.stream.getAudioTracks()) combined.addTrack(t);
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 4_500_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const s: Session = {
    screen,
    cam,
    mic,
    combined,
    recorder,
    chunks,
    startedAt: Date.now(),
    width,
    height,
    mimeType: mimeType || 'video/webm',
    rafId: null,
    recognizer: null,
    transcript: [],
    partialStart: null,
  };
  session = s;

  drawComposite(s, canvas, screenEl, camEl);

  screenTrack.addEventListener('ended', () => {
    void stopSession();
  });

  recorder.onstop = async () => {
    const blob = new Blob(s.chunks, { type: s.mimeType });
    const durationMs = Date.now() - s.startedAt;
    try {
      const rec = await saveRecording({
        blob,
        mimeType: s.mimeType,
        durationMs,
        width: s.width,
        height: s.height,
        transcript: s.transcript,
      });
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOPPED', recordingId: rec.id } satisfies Message);
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_ERROR', message: (e as Error).message } satisfies Message);
    } finally {
      teardown();
    }
  };

  recorder.start(1000);
  if (config.withMic) startRecognition(s);
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STARTED' } satisfies Message);
}

function teardown() {
  if (!session) return;
  const s = session;
  if (s.rafId !== null) cancelAnimationFrame(s.rafId);
  for (const stream of [s.screen, s.cam, s.mic]) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  if (s.recognizer) {
    try {
      s.recognizer.onend = null;
      s.recognizer.stop();
    } catch {}
  }
  session = null;
}

async function stopSession(): Promise<void> {
  if (!session) return;
  if (session.recorder.state !== 'inactive') {
    session.recorder.stop();
  } else {
    teardown();
  }
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_START') {
    startSession(msg.config)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_ERROR', message: (e as Error).message } satisfies Message);
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }
  if (msg.type === 'OFFSCREEN_STOP') {
    stopSession().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' } satisfies Message);
