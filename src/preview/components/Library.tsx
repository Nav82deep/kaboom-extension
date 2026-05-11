import { useMemo, useState, useEffect } from 'preact/hooks';
import type { Recording } from '../../lib/db';
import { formatBytes, formatTime, formatRelative } from '../lib/format';

interface Props {
  recordings: Recording[];
  onOpen: (r: Recording) => void;
  onDelete: (r: Recording) => void;
}

export function Library({ recordings, onOpen, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    if (!query.trim()) return recordings;
    const q = query.toLowerCase();
    return recordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.transcript.some((c) => c.text.toLowerCase().includes(q)),
    );
  }, [recordings, query]);

  return (
    <div class="min-h-screen px-6 lg:px-10 py-8 max-w-[1200px] mx-auto">
      <header class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff4e2c] to-[#ff8a5c] text-white font-bold grid place-items-center text-sm shadow-soft">
            K
          </div>
          <div>
            <div class="text-[15px] font-semibold leading-tight">Kamboom</div>
            <div class="text-[11px] text-[var(--ink-500)]">Library</div>
          </div>
        </div>
        <div class="relative w-full max-w-xs">
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-400)]"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            class="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[var(--ink-200)] rounded-lg focus:outline-none focus:border-[var(--accent)] shadow-soft"
            placeholder="Search recordings & transcripts…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
      </header>

      {filtered.length === 0 ? (
        <div class="surface p-12 text-center">
          <div class="text-5xl mb-3">📭</div>
          <h2 class="text-lg font-semibold mb-1">
            {recordings.length === 0 ? 'No recordings yet' : 'No matches'}
          </h2>
          <p class="text-sm text-[var(--ink-500)]">
            {recordings.length === 0
              ? 'Open the popup and start your first recording.'
              : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <Card key={r.id} rec={r} onOpen={() => onOpen(r)} onDelete={() => onDelete(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({
  rec,
  onOpen,
  onDelete,
}: {
  rec: Recording;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      url = URL.createObjectURL(rec.blob);
      if (cancelled) return;
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.crossOrigin = 'anonymous';
      await new Promise<void>((res) => {
        video.onloadeddata = () => res();
        video.onerror = () => res();
      });
      try {
        video.currentTime = Math.min(0.5, video.duration / 2);
        await new Promise<void>((res) => {
          video.onseeked = () => res();
        });
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (!cancelled) setThumb(canvas.toDataURL('image/jpeg', 0.7));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rec.blob]);

  return (
    <div class="surface overflow-hidden group cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-lg">
      <div
        class="aspect-video bg-[var(--ink-900)] relative overflow-hidden"
        onClick={onOpen}
      >
        {thumb ? (
          <img src={thumb} class="w-full h-full object-cover" />
        ) : (
          <div class="w-full h-full grid place-items-center text-[var(--ink-500)] text-xs">
            Loading preview…
          </div>
        )}
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[11px] font-mono">
          {formatTime(rec.durationMs)}
        </div>
        <div class="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
          <div class="w-12 h-12 rounded-full bg-white/95 grid place-items-center shadow-xl">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-[var(--ink-900)] ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
      <div class="p-3.5">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0" onClick={onOpen}>
            <h3 class="text-sm font-semibold truncate">{rec.name}</h3>
            <p class="text-[11px] text-[var(--ink-500)] mt-0.5">
              {formatRelative(rec.createdAt)} · {formatBytes(rec.blob.size)}
            </p>
          </div>
          <button
            class="btn btn-ghost p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${rec.name}"?`)) onDelete();
            }}
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
