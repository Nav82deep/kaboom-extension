import type { Message } from '../lib/messages';

const HOST_ID = '__kaboom_overlay_host__';

interface Stroke {
  tool: 'pen' | 'highlight' | 'arrow';
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

interface State {
  annotating: boolean;
  recording: boolean;
  startedAt: number | null;
  tool: 'pen' | 'highlight' | 'arrow' | 'erase';
  color: string;
  width: number;
  strokes: Stroke[];
  current: Stroke | null;
}

declare global {
  interface Window {
    __kaboomOverlayInit?: boolean;
  }
}

if (!window.__kaboomOverlayInit) {
  window.__kaboomOverlayInit = true;
  install();
}

function install() {
  const state: State = {
    annotating: false,
    recording: false,
    startedAt: null,
    tool: 'pen',
    color: '#ff4e2c',
    width: 4,
    strokes: [],
    current: null,
  };

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const annotationLayer = document.createElement('div');
  annotationLayer.className = 'annotation-layer';
  annotationLayer.style.display = 'none';
  shadow.appendChild(annotationLayer);

  const canvas = document.createElement('canvas');
  annotationLayer.appendChild(canvas);

  const annotationToolbar = document.createElement('div');
  annotationToolbar.className = 'annotation-toolbar';
  buildAnnotationToolbar(annotationToolbar, state, () => redraw(), setAnnotating);
  shadow.appendChild(annotationToolbar);
  annotationToolbar.style.display = 'none';

  const recIndicator = document.createElement('div');
  recIndicator.className = 'rec-indicator';
  recIndicator.style.display = 'none';
  shadow.appendChild(recIndicator);

  document.documentElement.appendChild(host);

  function setAnnotating(on: boolean) {
    if (state.annotating === on) return;
    state.annotating = on;
    annotationLayer.style.display = on ? 'block' : 'none';
    annotationToolbar.style.display = on ? 'flex' : 'none';
    if (on) {
      sizeCanvas();
      refreshAnnotationToolbar(state, shadow);
    } else {
      state.strokes = [];
      state.current = null;
    }
    chrome.runtime.sendMessage({ type: 'CONTENT_ANNOTATION_CHANGED', active: on } satisfies Message);
  }

  function setRecording(on: boolean, startedAt: number | null) {
    state.recording = on;
    state.startedAt = startedAt;
    recIndicator.style.display = on ? 'flex' : 'none';
    if (on) renderIndicator();
  }

  function renderIndicator() {
    if (!state.recording || !state.startedAt) return;
    recIndicator.innerHTML = INDICATOR_HTML;
    const stopBtn = recIndicator.querySelector('.rec-stop') as HTMLButtonElement | null;
    if (stopBtn) {
      stopBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: 'CONTENT_STOP_RECORDING' } satisfies Message);
      };
    }
    updateTimer();
  }

  function updateTimer() {
    if (!state.recording || !state.startedAt) return;
    const elapsed = Date.now() - state.startedAt;
    const total = Math.floor(elapsed / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const el = recIndicator.querySelector('.rec-timer');
    if (el) el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  setInterval(updateTimer, 500);

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
    redraw();
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.restore();
    for (const s of state.strokes) drawStroke(ctx, s);
    if (state.current) drawStroke(ctx, state.current);
  }

  function onDown(e: PointerEvent) {
    if (!state.annotating) return;
    if (state.tool === 'erase') return;
    const path = (e.composedPath?.() as EventTarget[]) ?? [];
    if (path.includes(annotationToolbar) || path.includes(recIndicator)) return;
    e.preventDefault();
    state.current = {
      tool: state.tool,
      color: state.color,
      width: state.width,
      points: [{ x: e.clientX, y: e.clientY }],
    };
    redraw();
  }

  function onMove(e: PointerEvent) {
    if (!state.current) return;
    state.current.points.push({ x: e.clientX, y: e.clientY });
    redraw();
  }

  function onUp() {
    if (!state.current) return;
    if (state.current.points.length > 1) state.strokes.push(state.current);
    state.current = null;
    redraw();
  }

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', onUp);

  window.addEventListener('keydown', (e) => {
    if (state.annotating && e.key === 'Escape') {
      setAnnotating(false);
    }
  });

  window.addEventListener('resize', () => state.annotating && sizeCanvas());

  chrome.runtime.onMessage.addListener((msg: Message, _s, sendResponse) => {
    if (msg.type === 'CONTENT_TOGGLE_ANNOTATION') {
      setAnnotating(msg.active);
      sendResponse({ ok: true });
    } else if (msg.type === 'CONTENT_RECORDING_STATE') {
      setRecording(msg.recording, msg.startedAt);
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.runtime.sendMessage({ type: 'POPUP_STATUS_REQUEST' } satisfies Message, (res: unknown) => {
    if (res && typeof res === 'object' && 'recording' in res) {
      const status = res as { recording: boolean; startedAt: number | null; annotation: boolean };
      setRecording(status.recording, status.startedAt);
      if (status.annotation) setAnnotating(true);
    }
  });
}

function buildAnnotationToolbar(
  bar: HTMLDivElement,
  state: State,
  redraw: () => void,
  setAnnotating: (v: boolean) => void,
) {
  bar.innerHTML = `
    <span class="badge"><span class="dot"></span>Drawing on screen</span>
    <span class="divider"></span>
    <button class="tb-btn" data-tool="pen" title="Pen"><svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
    <button class="tb-btn" data-tool="highlight" title="Highlighter"><svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M14 4l3-1 4 4-1 3"/></svg></button>
    <button class="tb-btn" data-tool="arrow" title="Arrow"><svg viewBox="0 0 24 24"><path d="M5 19L19 5M19 5h-7M19 5v7"/></svg></button>
    <button class="tb-btn" data-tool="erase" title="Clear all"><svg viewBox="0 0 24 24"><path d="M18 13l-6-6L5 14l4 4h7zM12 19h9"/></svg></button>
    <span class="divider"></span>
    ${['#ff4e2c', '#fcc419', '#22c55e', '#3b82f6', '#ffffff', '#0e0f13']
      .map((c) => `<button class="swatch" data-color="${c}" style="background:${c}"></button>`)
      .join('')}
    <span class="divider"></span>
    <button class="tb-done" title="Exit drawing (Esc)">Done</button>
  `;

  bar.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tool = btn.dataset.tool as State['tool'];
      if (tool === 'erase') {
        state.strokes = [];
        redraw();
        return;
      }
      state.tool = tool;
      refreshAnnotationToolbar(state, bar.getRootNode() as ShadowRoot);
    });
  });

  bar.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((sw) => {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      state.color = sw.dataset.color!;
      refreshAnnotationToolbar(state, bar.getRootNode() as ShadowRoot);
    });
  });

  const done = bar.querySelector<HTMLButtonElement>('.tb-done');
  if (done) done.addEventListener('click', (e) => {
    e.stopPropagation();
    setAnnotating(false);
  });
}

function refreshAnnotationToolbar(state: State, shadow: ShadowRoot | DocumentFragment) {
  shadow.querySelectorAll<HTMLElement>('[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === state.tool);
  });
  shadow.querySelectorAll<HTMLElement>('[data-color]').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.color === state.color);
  });
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === 'highlight') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = s.width * 4;
  } else {
    ctx.globalAlpha = 1;
    ctx.lineWidth = s.width;
  }
  if (s.tool === 'arrow' && s.points.length >= 2) {
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = 14;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len * Math.cos(angle - Math.PI / 6), b.y - len * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(b.x - len * Math.cos(angle + Math.PI / 6), b.y - len * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const INDICATOR_HTML = `
  <span class="rec-dot"></span>
  <span class="rec-label">Recording</span>
  <span class="rec-timer">00:00</span>
  <button class="rec-stop" title="Stop recording (⌘⇧L)">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
    Stop
  </button>
`;

const STYLES = `
  :host { all: initial; }

  .annotation-layer {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    cursor: crosshair;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
  }

  .annotation-toolbar {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(14, 15, 19, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: white;
    border-radius: 14px;
    padding: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
    pointer-events: auto;
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    font-size: 13px;
    user-select: none;
  }
  .tb-btn {
    width: 34px; height: 34px;
    display: grid; place-items: center;
    border-radius: 9px;
    cursor: pointer;
    color: rgba(255,255,255,0.7);
    transition: all 120ms ease;
    background: transparent;
    border: none;
  }
  .tb-btn:hover { color: white; background: rgba(255,255,255,0.08); }
  .tb-btn.active { color: white; background: rgba(255, 78, 44, 0.85); }
  .tb-btn svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .divider { width: 1px; height: 22px; background: rgba(255,255,255,0.12); margin: 0 4px; display: inline-block; }
  .swatch {
    width: 22px; height: 22px;
    border-radius: 50%;
    margin: 6px 3px;
    cursor: pointer;
    transition: transform 120ms ease;
    border: 2px solid transparent;
    padding: 0;
  }
  .swatch:hover { transform: scale(1.15); }
  .swatch.active { border-color: white; transform: scale(1.1); }
  .badge {
    padding: 0 10px;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: rgba(255,255,255,0.85);
    display: inline-flex;
    align-items: center;
  }
  .badge .dot {
    display: inline-block;
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #ff4e2c;
    margin-right: 6px;
    animation: kaboom-pulse 1.5s ease-in-out infinite;
  }
  .tb-done {
    border: none;
    background: white;
    color: #0e0f13;
    font: inherit;
    font-weight: 600;
    font-size: 12px;
    padding: 7px 14px;
    border-radius: 9px;
    margin: 0 4px 0 0;
    cursor: pointer;
    transition: opacity 120ms ease;
  }
  .tb-done:hover { opacity: 0.85; }

  .rec-indicator {
    position: fixed;
    left: 20px;
    bottom: 20px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 9px 9px 16px;
    background: rgba(14, 15, 19, 0.94);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: white;
    border-radius: 999px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.08);
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    user-select: none;
    animation: kaboom-fade-in 200ms ease;
  }
  .rec-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ff4e2c;
    box-shadow: 0 0 0 0 rgba(255, 78, 44, 0.6);
    animation: kaboom-rec-pulse 1.4s ease-in-out infinite;
  }
  .rec-label {
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: -0.005em;
  }
  .rec-timer {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.65);
    font-variant-numeric: tabular-nums;
    padding-right: 6px;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    margin-right: 0;
  }
  .rec-stop {
    border: none;
    background: rgba(255, 78, 44, 0.95);
    color: white;
    font: inherit;
    font-weight: 600;
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: background 120ms ease;
  }
  .rec-stop:hover { background: #c93d20; }

  @keyframes kaboom-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes kaboom-rec-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 78, 44, 0.6); }
    50% { box-shadow: 0 0 0 6px rgba(255, 78, 44, 0); }
  }
  @keyframes kaboom-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

export {};
