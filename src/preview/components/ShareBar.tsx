import { useState } from 'preact/hooks';
import type { Recording } from '../../lib/db';
import { formatBytes, formatTime } from '../lib/format';

interface Props {
  rec: Recording;
}

export function ShareBar({ rec }: Props) {
  const [copied, setCopied] = useState(false);

  function download() {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.name.replace(/[^a-z0-9-_ ]+/gi, '').replace(/\s+/g, '-') || 'recording'}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyLink() {
    const url = `chrome-extension://${chrome.runtime.id}/src/preview/preview.html?id=${rec.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <div class="surface p-4 flex items-center gap-3 flex-wrap">
      <div class="flex-1 min-w-[200px]">
        <div class="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-500)] font-semibold mb-1">
          Ready to share
        </div>
        <div class="text-sm text-[var(--ink-700)]">
          {formatTime(rec.durationMs)} · {rec.width}×{rec.height} · {formatBytes(rec.blob.size)}
        </div>
      </div>
      <button class="btn btn-secondary" onClick={copyLink}>
        {copied ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15V5a2 2 0 012-2h10" />
            </svg>
            Copy link
          </>
        )}
      </button>
      <button class="btn btn-primary" onClick={download}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3v12M5 12l7 7 7-7M5 21h14" />
        </svg>
        Download
      </button>
    </div>
  );
}
