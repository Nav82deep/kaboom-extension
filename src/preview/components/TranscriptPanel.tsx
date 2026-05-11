import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TranscriptCue } from '../../lib/messages';
import { formatTime } from '../lib/format';

interface Props {
  cues: TranscriptCue[];
  currentTime: number;
  onSeek: (t: number) => void;
}

export function TranscriptPanel({ cues, currentTime, onSeek }: Props) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const activeIdx = useMemo(() => {
    const ms = currentTime * 1000;
    let idx = -1;
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].start <= ms && ms <= cues[i].end + 500) idx = i;
    }
    return idx;
  }, [cues, currentTime]);

  const filtered = useMemo(() => {
    if (!query.trim()) return cues;
    const q = query.toLowerCase();
    return cues.filter((c) => c.text.toLowerCase().includes(q));
  }, [cues, query]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = listRef.current?.querySelector(`[data-cue-idx="${activeIdx}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIdx]);

  function exportSrt() {
    const srt = cues
      .map((c, i) => `${i + 1}\n${srtTs(c.start)} --> ${srtTs(c.end)}\n${c.text}\n`)
      .join('\n');
    const blob = new Blob([srt], { type: 'text/srt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.srt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (cues.length === 0) {
    return (
      <div class="surface p-5">
        <h3 class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-500)] mb-2">
          Transcript
        </h3>
        <p class="text-sm text-[var(--ink-400)] leading-relaxed">
          No transcript captured. Enable the microphone before recording to get
          a live, searchable transcript with clickable timestamps.
        </p>
      </div>
    );
  }

  return (
    <div class="surface flex flex-col h-[640px]">
      <div class="px-4 pt-4 pb-3 border-b border-[var(--ink-200)]">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-500)]">
            Transcript
          </h3>
          <button class="btn btn-ghost text-[11px]" onClick={exportSrt} title="Download as .srt">
            Export .srt
          </button>
        </div>
        <div class="relative">
          <svg
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-400)]"
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
            class="w-full pl-8 pr-3 py-2 text-sm bg-[var(--ink-50)] border border-[var(--ink-200)] rounded-lg focus:outline-none focus:border-[var(--accent)] focus:bg-white"
            placeholder="Search transcript…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div ref={listRef} class="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {filtered.length === 0 ? (
          <p class="text-sm text-[var(--ink-400)] p-3">No matches.</p>
        ) : (
          filtered.map((cue) => {
            const idx = cues.indexOf(cue);
            return (
              <div
                key={idx}
                data-cue-idx={idx}
                class={`transcript-line ${idx === activeIdx ? 'active' : ''}`}
                onClick={() => onSeek(cue.start / 1000)}
              >
                <span class="ts">{formatTime(cue.start)}</span>
                <span class="flex-1">{cue.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function srtTs(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const r = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}
