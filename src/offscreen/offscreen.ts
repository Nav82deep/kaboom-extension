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
  renderTimerId: number | null;
  audioContext: AudioContext | null;
  recognizer: SpeechRecognition | null;
  transcript: TranscriptCue[];
  partialStart: number | null;
}

let session: Session | null = null;

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
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

async function getCam(): Promise<{ stream: MediaStream | null; error: string | null }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });
    return { stream, error: null };
  } catch (e) {
    return { stream: null, error: (e as Error).message || 'Camera permission denied' };
  }
}

async function getMic(): Promise<{ stream: MediaStream | null; error: string | null }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    return { stream, error: null };
  } catch (e) {
    return { stream: null, error: (e as Error).message || 'Microphone permission denied' };
  }
}

function startCanvasComposite(
  canvas: HTMLCanvasElement,
  screenEl: HTMLVideoElement,
  camEl: HTMLVideoElement | null,
): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const render = () => {
    if (!session) return;
    if (screenEl.readyState < 2) return;
    ctx.drawImage(screenEl, 0, 0, canvas.width, canvas.height);
    if (camEl && camEl.readyState >= 2 && camEl.videoWidth > 0) {
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
      const camW = camEl.videoWidth;
      const camH = camEl.videoHeight;
      const side = Math.min(camW, camH);
      const sx = (camW - side) / 2;
      const sy = (camH - side) / 2;
      ctx.drawImage(camEl, sx, sy, side, side, cx, cy, camSize, camSize);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx + r, cy + r, r + 1, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
  };
  return window.setInterval(render, 33);
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
  let cam: MediaStream | null = null;
  if (config.withCam) {
    const result = await getCam();
    cam = result.stream;
    if (!cam && result.error) {
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_ERROR',
        message: `Camera access denied. Recording the screen without the webcam bubble. Grant camera permission to the extension and try again. (${result.error})`,
      } satisfies Message);
      for (const t of screen.getTracks()) t.stop();
      return;
    }
  }
  let mic: MediaStream | null = null;
  if (config.withMic) {
    const result = await getMic();
    mic = result.stream;
    if (!mic && result.error) {
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_ERROR',
        message: `Microphone access denied. Grant microphone permission to the extension (click the camera/mic icon in Chrome's address bar) and try again. (${result.error})`,
      } satisfies Message);
      for (const t of screen.getTracks()) t.stop();
      if (cam) for (const t of cam.getTracks()) t.stop();
      return;
    }
  }

  const screenTrack = screen.getVideoTracks()[0];
  const screenSettings = screenTrack.getSettings();
  const width = screenSettings.width ?? 1920;
  const height = screenSettings.height ?? 1080;

  let videoTracks: MediaStreamTrack[];
  let renderTimerId: number | null = null;

  if (cam) {
    const canvas = document.getElementById('composite') as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;
    const screenEl = document.getElementById('screenVideo') as HTMLVideoElement;
    const camEl = document.getElementById('camVideo') as HTMLVideoElement;
    screenEl.srcObject = screen;
    camEl.srcObject = cam;
    await Promise.all([screenEl.play(), camEl.play()]);
    renderTimerId = startCanvasComposite(canvas, screenEl, camEl);
    const canvasStream = canvas.captureStream(30);
    videoTracks = canvasStream.getVideoTracks();
  } else {
    videoTracks = screen.getVideoTracks();
  }

  const audioSources: MediaStream[] = [];
  if (mic && mic.getAudioTracks().length) audioSources.push(mic);
  if (config.withSystemAudio && screen.getAudioTracks().length) {
    audioSources.push(new MediaStream(screen.getAudioTracks()));
  }

  const combined = new MediaStream();
  for (const t of videoTracks) combined.addTrack(t);

  let audioContext: AudioContext | null = null;
  if (audioSources.length === 1) {
    for (const t of audioSources[0].getAudioTracks()) combined.addTrack(t);
  } else if (audioSources.length > 1) {
    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const dest = audioContext.createMediaStreamDestination();
    for (const src of audioSources) {
      const node = audioContext.createMediaStreamSource(src);
      node.connect(dest);
    }
    for (const t of dest.stream.getAudioTracks()) combined.addTrack(t);
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    combined,
    mimeType ? { mimeType, videoBitsPerSecond: 4_500_000 } : undefined,
  );
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
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
    renderTimerId,
    audioContext,
    recognizer: null,
    transcript: [],
    partialStart: null,
  };
  session = s;

  screenTrack.addEventListener('ended', () => {
    void stopSession();
  });

  recorder.onstop = async () => {
    try {
      const blob = new Blob(s.chunks, { type: s.mimeType });
      if (blob.size === 0) {
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_ERROR',
          message: 'Recording produced no data. Try again, and if the issue persists check that the chosen source is actually visible during the recording.',
        } satisfies Message);
        return;
      }
      const durationMs = Date.now() - s.startedAt;
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
  if (s.renderTimerId !== null) clearInterval(s.renderTimerId);
  for (const stream of [s.screen, s.cam, s.mic]) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  if (s.audioContext) {
    s.audioContext.close().catch(() => {});
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
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_ERROR',
          message: (e as Error).message,
        } satisfies Message);
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
