import type { Message } from '../lib/messages';

const HOST_ID = '__kamboom_annotator_host__';

interface Stroke {
  tool: 'pen' | 'highlight' | 'arrow';
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

interface State {
  active: boolean;
  tool: 'pen' | 'highlight' | 'arrow' | 'erase';
  color: string;
  width: number;
  strokes: Stroke[];
  current: Stroke | null;
}

declare global {
  interface Window {
    __kamboomAnnotatorInit?: boolean;
  }
}

if (!window.__kamboomAnnotatorInit) {
  window.__kamboomAnnotatorInit = true;
  install();
}

function install() {
  const state: State = {
    active: false,
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
    display: 'none',
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .layer {
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
    .toolbar {
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
    .divider { width: 1px; height: 22px; background: rgba(255,255,255,0.12); margin: 0 4px; }
    .swatch {
      width: 22px; height: 22px;
      border-radius: 50%;
      margin: 6px 3px;
      cursor: pointer;
      transition: transform 120ms ease;
      border: 2px solid transparent;
    }
    .swatch:hover { transform: scale(1.15); }
    .swatch.active { border-color: white; transform: scale(1.1); }
    .badge {
      padding: 0 10px;
      font-weight: 500;
      letter-spacing: -0.005em;
      color: rgba(255,255,255,0.85);
    }
    .badge .dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #ff4e2c;
      margin-right: 6px;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  shadow.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'layer';
  shadow.appendChild(layer);

  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  shadow.appendChild(toolbar);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.innerHTML = '<span class="dot"></span>Drawing';
  toolbar.appendChild(badge);

  toolbar.appendChild(divider());

  const tools: { id: State['tool']; label: string; svg: string }[] = [
    { id: 'pen', label: 'Pen', svg: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
    { id: 'highlight', label: 'Highlighter', svg: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M14 4l3-1 4 4-1 3"/>' },
    { id: 'arrow', label: 'Arrow', svg: '<path d="M5 19L19 5M19 5h-7M19 5v7"/>' },
    { id: 'erase', label: 'Clear', svg: '<path d="M18 13l-6-6L5 14l4 4h7zM12 19h9"/>' },
  ];
  const toolButtons: Record<string, HTMLButtonElement> = {};
  for (const t of tools) {
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.title = t.label;
    b.innerHTML = `<svg viewBox="0 0 24 24">${t.svg}</svg>`;
    b.onclick = () => {
      if (t.id === 'erase') {
        state.strokes = [];
        redraw();
        return;
      }
      state.tool = t.id;
      updateActive();
    };
    toolbar.appendChild(b);
    toolButtons[t.id] = b;
  }

  toolbar.appendChild(divider());

  const colors = ['#ff4e2c', '#fcc419', '#22c55e', '#3b82f6', '#ffffff', '#0e0f13'];
  const swatches: Record<string, HTMLDivElement> = {};
  for (const c of colors) {
    const s = document.createElement('div');
    s.className = 'swatch';
    s.style.background = c;
    s.onclick = () => {
      state.color = c;
      updateActive();
    };
    toolbar.appendChild(s);
    swatches[c] = s;
  }

  toolbar.appendChild(divider());

  const close = document.createElement('button');
  close.className = 'tb-btn';
  close.title = 'Exit drawing mode (⌘⇧K)';
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6l-12 12"/></svg>';
  close.onclick = () => setActive(false);
  toolbar.appendChild(close);

  document.documentElement.appendChild(host);

  function divider() {
    const d = document.createElement('div');
    d.className = 'divider';
    return d;
  }

  function updateActive() {
    for (const k of Object.keys(toolButtons)) {
      toolButtons[k].classList.toggle('active', k === state.tool);
    }
    for (const c of Object.keys(swatches)) {
      swatches[c].classList.toggle('active', c === state.color);
    }
  }

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

  function onPointerDown(e: PointerEvent) {
    if (state.tool === 'erase') return;
    layer.setPointerCapture(e.pointerId);
    state.current = {
      tool: state.tool,
      color: state.color,
      width: state.width,
      points: [{ x: e.clientX, y: e.clientY }],
    };
    redraw();
  }

  function onPointerMove(e: PointerEvent) {
    if (!state.current) return;
    state.current.points.push({ x: e.clientX, y: e.clientY });
    redraw();
  }

  function onPointerUp() {
    if (!state.current) return;
    if (state.current.points.length > 1) state.strokes.push(state.current);
    state.current = null;
    redraw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function setActive(on: boolean) {
    if (state.active === on) return;
    state.active = on;
    host.style.display = on ? 'block' : 'none';
    if (on) {
      sizeCanvas();
      updateActive();
    } else {
      state.strokes = [];
      state.current = null;
    }
    chrome.runtime.sendMessage({ type: 'CONTENT_ANNOTATION_CHANGED', active: on } satisfies Message);
  }

  window.addEventListener('resize', () => state.active && sizeCanvas());

  chrome.runtime.onMessage.addListener((msg: Message, _s, sendResponse) => {
    if (msg.type === 'CONTENT_TOGGLE_ANNOTATION') {
      setActive(msg.active);
      sendResponse({ ok: true });
    }
    return false;
  });
}

export {};
