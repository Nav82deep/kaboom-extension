import { useRef } from 'preact/hooks';
import type { TranscriptCue } from '../../lib/messages';

interface Props {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  cues: TranscriptCue[];
  onScrub: (t: number) => void;
  onTrimChange: (start: number, end: number) => void;
}

export function Timeline({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  cues,
  onScrub,
  onTrimChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  function pct(t: number) {
    return duration > 0 ? (t / duration) * 100 : 0;
  }

  function handleDrag(which: 'start' | 'end') {
    return (e: MouseEvent) => {
      e.stopPropagation();
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const move = (ev: MouseEvent) => {
        const f = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const t = f * duration;
        if (which === 'start') {
          onTrimChange(Math.min(t, trimEnd - 0.5), trimEnd);
        } else {
          onTrimChange(trimStart, Math.max(t, trimStart + 0.5));
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
  }

  function handleScrub(e: MouseEvent) {
    if (e.target !== ref.current && (e.target as HTMLElement).classList.contains('timeline-handle')) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onScrub(f * duration);
  }

  return (
    <div
      ref={ref}
      class="timeline-track"
      onMouseDown={handleScrub}
    >
      <div
        class="timeline-mask"
        style={{ left: 0, width: `${pct(trimStart)}%` }}
      />
      <div
        class="timeline-mask"
        style={{ left: `${pct(trimEnd)}%`, right: 0, width: `${100 - pct(trimEnd)}%` }}
      />
      <div
        class="timeline-progress"
        style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd) - pct(trimStart)}%` }}
      />

      {cues.slice(0, 60).map((c, i) => (
        <div
          key={i}
          class="timeline-cue"
          style={{ left: `${pct(c.start / 1000)}%` }}
          title={c.text}
        />
      ))}

      <div
        class="timeline-playhead"
        style={{ left: `${pct(currentTime)}%` }}
      />

      <div
        class="timeline-handle"
        style={{ left: `calc(${pct(trimStart)}% - 6px)` }}
        onMouseDown={handleDrag('start')}
      />
      <div
        class="timeline-handle"
        style={{ left: `calc(${pct(trimEnd)}% - 6px)` }}
        onMouseDown={handleDrag('end')}
      />
    </div>
  );
}
