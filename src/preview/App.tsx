import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getRecording, listRecordings, deleteRecording, updateRecording, replaceRecordingBlob, type Recording } from '../lib/db';
import { Timeline } from './components/Timeline';
import { TranscriptPanel } from './components/TranscriptPanel';
import { ShareBar } from './components/ShareBar';
import { Library } from './components/Library';
import { trimBlob, type TrimProgress } from './lib/trim';
import { formatTime } from './lib/format';

function useQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get('id'),
    library: params.get('library') === '1',
  };
}

export function App() {
  const { id, library } = useQuery();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [allRecordings, setAllRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (id) {
        const rec = await getRecording(id);
        setRecording(rec ?? null);
      }
      if (library || !id) {
        const all = await listRecordings();
        setAllRecordings(all);
      }
      setLoading(false);
    })();
  }, [id, library]);

  if (loading) return <Loading />;

  if (library || (!id && allRecordings.length > 0)) {
    return (
      <Library
        recordings={allRecordings}
        onOpen={(r) => {
          window.location.href = `?id=${r.id}`;
        }}
        onDelete={async (r) => {
          await deleteRecording(r.id);
          setAllRecordings(await listRecordings());
        }}
      />
    );
  }

  if (!id || !recording) return <Empty />;

  return (
    <PlayerView
      key={recording.id}
      rec={recording}
      onUpdate={async (r) => setRecording(await getRecording(r.id) ?? r)}
    />
  );
}

function Loading() {
  return (
    <div class="min-h-screen flex items-center justify-center text-[var(--ink-400)] text-sm">
      Loading…
    </div>
  );
}

function Empty() {
  return (
    <div class="min-h-screen flex items-center justify-center p-10">
      <div class="surface max-w-md text-center p-10">
        <div class="text-5xl mb-3">🎬</div>
        <h1 class="text-xl font-semibold mb-2">No recording yet</h1>
        <p class="text-sm text-[var(--ink-500)] mb-5">
          Open the Kamboom popup and hit <strong>Start recording</strong>, or press <kbd class="px-1.5 py-0.5 bg-[var(--ink-100)] rounded text-xs">⌘⇧L</kbd>.
        </p>
        <button class="btn btn-secondary" onClick={() => (window.location.href = '?library=1')}>
          Open library
        </button>
      </div>
    </div>
  );
}

interface PlayerProps {
  rec: Recording;
  onUpdate: (r: Recording) => void;
}

function PlayerView({ rec, onUpdate }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(rec.durationMs / 1000);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(rec.durationMs / 1000);
  const [trimming, setTrimming] = useState<TrimProgress | null>(null);
  const [title, setTitle] = useState(rec.name);
  const [isPlaying, setIsPlaying] = useState(false);

  const blobUrl = useMemo(() => URL.createObjectURL(rec.blob), [rec.blob]);

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : rec.durationMs / 1000;
      setDuration(d);
      if (trimEnd === 0 || trimEnd > d) setTrimEnd(d);
    };
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []);

  function seek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, t));
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  async function saveTitle(next: string) {
    setTitle(next);
    await updateRecording(rec.id, { name: next });
  }

  async function applyTrim() {
    if (trimStart === 0 && Math.abs(trimEnd - duration) < 0.1) return;
    setTrimming({ phase: 'loading', fraction: 0 });
    try {
      const { blob, durationMs } = await trimBlob(rec.blob, trimStart, trimEnd, setTrimming);
      await replaceRecordingBlob(rec.id, blob, durationMs);
      const updated = { ...rec, blob, durationMs };
      onUpdate(updated);
      setTrimStart(0);
      setTrimEnd(durationMs / 1000);
    } finally {
      setTrimming(null);
    }
  }

  const trimmed = trimStart > 0 || Math.abs(trimEnd - duration) > 0.1;

  return (
    <div class="min-h-screen px-6 lg:px-10 py-8 max-w-[1400px] mx-auto">
      <Header onLibrary={() => (window.location.href = '?library=1')} />

      <div class="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div class="space-y-4">
          <TitleField value={title} onChange={saveTitle} />

          <div class="player-shell">
            <video ref={videoRef} src={blobUrl} controls={false} preload="metadata" />
            <PlayOverlay isPlaying={isPlaying} onClick={togglePlay} />
          </div>

          <PlayerControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            onPlay={togglePlay}
            onSeek={seek}
          />

          <div class="surface p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-500)]">
                Trim
              </h3>
              <div class="flex items-center gap-2 text-xs text-[var(--ink-500)] font-mono">
                <span>{formatTime(trimStart * 1000)}</span>
                <span class="text-[var(--ink-300)]">→</span>
                <span>{formatTime(trimEnd * 1000)}</span>
                <span class="ml-2 px-2 py-0.5 rounded-full bg-[var(--ink-100)]">
                  {formatTime((trimEnd - trimStart) * 1000)}
                </span>
              </div>
            </div>
            <Timeline
              duration={duration}
              currentTime={currentTime}
              trimStart={trimStart}
              trimEnd={trimEnd}
              cues={rec.transcript}
              onScrub={seek}
              onTrimChange={(s, e) => {
                setTrimStart(s);
                setTrimEnd(e);
                seek(s);
              }}
            />
            <div class="flex items-center justify-between mt-3">
              <div class="text-xs text-[var(--ink-500)]">
                Drag the dark handles to set start and end. Click anywhere to jump.
              </div>
              <button
                class={`btn ${trimmed ? 'btn-accent' : 'btn-secondary'}`}
                disabled={!trimmed || !!trimming}
                onClick={applyTrim}
              >
                {trimming ? <TrimProgressLabel p={trimming} /> : trimmed ? 'Apply trim' : 'No changes'}
              </button>
            </div>
          </div>

          <ShareBar rec={rec} />
        </div>

        <aside class="space-y-4">
          <TranscriptPanel
            cues={rec.transcript}
            currentTime={currentTime}
            onSeek={seek}
          />
        </aside>
      </div>
    </div>
  );
}

function Header({ onLibrary }: { onLibrary: () => void }) {
  return (
    <header class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff4e2c] to-[#ff8a5c] text-white font-bold grid place-items-center text-sm shadow-soft">
          K
        </div>
        <div>
          <div class="text-[15px] font-semibold leading-tight">Kamboom</div>
          <div class="text-[11px] text-[var(--ink-500)]">Local-first screen recorder</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-ghost text-[var(--ink-500)]" onClick={onLibrary}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 11h8M8 15h5" />
          </svg>
          Library
        </button>
      </div>
    </header>
  );
}

function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      class="w-full bg-transparent text-2xl font-semibold tracking-tight focus:outline-none border-b border-transparent focus:border-[var(--ink-200)] py-1"
      value={local}
      onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
      onBlur={() => local.trim() && onChange(local.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function PlayOverlay({ isPlaying, onClick }: { isPlaying: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      class={`absolute inset-0 grid place-items-center transition-opacity duration-200 ${
        isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
      }`}
    >
      <div class="w-16 h-16 rounded-full bg-white/95 grid place-items-center shadow-2xl">
        {isPlaying ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" class="text-[var(--ink-900)]">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" class="text-[var(--ink-900)] ml-1">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </div>
    </button>
  );
}

function PlayerControls({
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onSeek,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlay: () => void;
  onSeek: (t: number) => void;
}) {
  return (
    <div class="surface px-4 py-3 flex items-center gap-3">
      <button class="btn btn-ghost p-2 -mx-1" onClick={onPlay} aria-label="Play / pause">
        {isPlaying ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <button class="btn btn-ghost p-2 -mx-1" onClick={() => onSeek(Math.max(0, currentTime - 5))} aria-label="Back 5s">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
      </button>
      <button class="btn btn-ghost p-2 -mx-1" onClick={() => onSeek(Math.min(duration, currentTime + 5))} aria-label="Forward 5s">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
      </button>
      <div class="flex-1 mx-2">
        <ScrubBar duration={duration} currentTime={currentTime} onSeek={onSeek} />
      </div>
      <div class="text-xs text-[var(--ink-500)] font-mono tabular-nums whitespace-nowrap">
        {formatTime(currentTime * 1000)} / {formatTime(duration * 1000)}
      </div>
    </div>
  );
}

function ScrubBar({
  duration,
  currentTime,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  function onDown(e: MouseEvent) {
    const el = ref.current;
    if (!el) return;
    function update(clientX: number) {
      const rect = el!.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(f * duration);
    }
    update(e.clientX);
    const move = (ev: MouseEvent) => update(ev.clientX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      class="relative h-1.5 rounded-full bg-[var(--ink-200)] cursor-pointer group"
    >
      <div
        class="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
        style={{ width: `${pct}%` }}
      />
      <div
        class="absolute -top-1.5 w-4 h-4 rounded-full bg-white border-2 border-[var(--accent)] -translate-x-1/2 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

function TrimProgressLabel({ p }: { p: TrimProgress }) {
  const label = p.phase === 'loading' ? 'Loading…' : p.phase === 'rendering' ? 'Trimming' : 'Finalizing';
  return (
    <span class="inline-flex items-center gap-2">
      <span class="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
      {label} {Math.round(p.fraction * 100)}%
    </span>
  );
}
