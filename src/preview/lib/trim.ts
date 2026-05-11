export interface TrimResult {
  blob: Blob;
  durationMs: number;
}

export interface TrimProgress {
  phase: 'loading' | 'rendering' | 'finalizing';
  fraction: number;
}

export async function trimBlob(
  source: Blob,
  startSec: number,
  endSec: number,
  onProgress?: (p: TrimProgress) => void,
): Promise<TrimResult> {
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.muted = false;
  video.crossOrigin = 'anonymous';
  video.playsInline = true;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('Cannot load source video'));
  });
  onProgress?.({ phase: 'loading', fraction: 1 });

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const fps = 30;
  const videoStream = canvas.captureStream(fps);
  const combined = new MediaStream();
  for (const t of videoStream.getVideoTracks()) combined.addTrack(t);

  let audioCtx: AudioContext | null = null;
  let audioDest: MediaStreamAudioDestinationNode | null = null;
  let audioSource: MediaElementAudioSourceNode | null = null;
  try {
    audioCtx = new AudioContext();
    audioDest = audioCtx.createMediaStreamDestination();
    audioSource = audioCtx.createMediaElementSource(video);
    audioSource.connect(audioDest);
    for (const t of audioDest.stream.getAudioTracks()) combined.addTrack(t);
  } catch {
  }

  const mime = pickMime();
  const recorder = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 4_500_000 } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const trimmedMs = (endSec - startSec) * 1000;

  await seekTo(video, startSec);

  recorder.start(500);

  await new Promise<void>((resolve) => {
    let stopped = false;
    let raf = 0;
    const draw = () => {
      if (stopped) return;
      ctx.drawImage(video, 0, 0, width, height);
      const elapsed = (video.currentTime - startSec) * 1000;
      onProgress?.({ phase: 'rendering', fraction: Math.min(1, elapsed / trimmedMs) });
      if (video.currentTime >= endSec || video.ended) {
        stopped = true;
        cancelAnimationFrame(raf);
        recorder.requestData();
        recorder.stop();
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    recorder.onstop = () => resolve();
    video.play().then(() => {
      draw();
    });
  });

  onProgress?.({ phase: 'finalizing', fraction: 1 });
  URL.revokeObjectURL(sourceUrl);
  if (audioCtx) {
    try {
      await audioCtx.close();
    } catch {}
  }

  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  return { blob, durationMs: trimmedMs };
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = t;
  });
}

function pickMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const t of candidates) if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
