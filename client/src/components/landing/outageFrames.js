/**
 * "Anatomy of an outage" — a 240-frame, scroll-scrubbed sequence.
 *
 * Every frame is a pure function of its index (no clocks, no randomness), so
 * scrolling to frame 137 always draws exactly frame 137 — the same contract as an
 * image sequence, but rendered at device resolution and weighing a few KB instead
 * of a few hundred images.
 *
 *   0–47    STEADY    heartbeat trace, per-beat latency readouts
 *   48–95   FAILURE   the trace flatlines red at frame 56
 *   96–143  CONFIRM   three probe attempts must all fail
 *   144–191 ALERT     packets fan out to Slack / Discord / Email / Webhook
 *   192–239 RECOVER   trace returns, then folds into the 90-day uptime record
 */

export const FRAME_COUNT = 240;

export const CHAPTERS = [
  { id: 'steady', label: 'Steady', start: 0, end: 47 },
  { id: 'failure', label: 'Failure', start: 48, end: 95 },
  { id: 'confirm', label: 'Confirm', start: 96, end: 143 },
  { id: 'alert', label: 'Alert', start: 144, end: 191 },
  { id: 'recover', label: 'Recover', start: 192, end: 239 },
];

const F_DOWN = 56; // frame the endpoint starts failing
const F_UP = 198; // frame it recovers
const ATTEMPTS = [100, 114, 128]; // frames each confirmation probe fires
const SPEED = 6; // signal px advanced per frame
const PERIOD = 150; // px per heartbeat

const INK = '11, 11, 10';
const PAPER = '237, 232, 223';
const UP = '70, 212, 131';
const DOWN = '255, 74, 85';
const WARN = '242, 181, 68';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SERIF = '"Instrument Serif", Georgia, serif';

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (x, a, b) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** One ECG-style heartbeat over u ∈ [0, 1). Returns amplitude in roughly [-0.3, 1]. */
export const beat = (u) => {
  if (u >= 0.1 && u < 0.18) return 0.12 * Math.sin((Math.PI * (u - 0.1)) / 0.08);
  if (u >= 0.24 && u < 0.27) return -0.16 * Math.sin((Math.PI * (u - 0.24)) / 0.03);
  if (u >= 0.27 && u < 0.31) return Math.sin((Math.PI * (u - 0.27)) / 0.04);
  if (u >= 0.31 && u < 0.35) return -0.3 * Math.sin((Math.PI * (u - 0.31)) / 0.04);
  if (u >= 0.48 && u < 0.62) return 0.22 * Math.sin((Math.PI * (u - 0.48)) / 0.14);
  return 0;
};

/** Plausible, deterministic response time for heartbeat #k. */
export const latencyFor = (k) => Math.round(92 + hash(k) * 64 + (hash(k * 3.7) > 0.92 ? 120 : 0));

const phaseOf = (s) => (((s % PERIOD) + PERIOD) % PERIOD) / PERIOD;
const stateAt = (s) => {
  const fr = s / SPEED;
  if (fr < F_DOWN) return 'up';
  if (fr < F_UP) return 'down';
  return 'rec';
};
const colorOf = (state) => (state === 'down' ? DOWN : state === 'rec' ? UP : PAPER);

const CHANNELS = [
  { label: 'SLACK', detail: '#incidents', ms: 412 },
  { label: 'DISCORD', detail: '#ops-alerts', ms: 388 },
  { label: 'EMAIL', detail: 'oncall@', ms: 1290 },
  { label: 'WEBHOOK', detail: 'POST /hooks', ms: 205 },
];

export function createSequence(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let grid = null;
  let L = null; // layout

  const buildGrid = () => {
    grid = document.createElement('canvas');
    grid.width = Math.round(W * dpr);
    grid.height = Math.round(H * dpr);
    const g = grid.getContext('2d');
    g.scale(dpr, dpr);
    const step = W < 768 ? 22 : 28;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        // Vignette: grid fades toward the edges.
        const dx = (x - W / 2) / (W / 2);
        const dy = (y - H / 2) / (H / 2);
        const a = 0.085 * (1 - clamp(Math.sqrt(dx * dx * 0.6 + dy * dy), 0, 1));
        if (a <= 0.005) continue;
        g.fillStyle = `rgba(${PAPER}, ${a})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mobile = W < 768;
    const A = Math.min(H * 0.12, mobile ? 56 : 92);
    const cy = H * (mobile ? 0.4 : 0.47);
    const nodeX = W * (mobile ? 0.88 : 0.82);
    L = {
      mobile,
      wide: W >= 1100,
      A,
      cy,
      px: W * (mobile ? 0.6 : 0.56),
      nodeX,
      nodes: [-1.5, -0.5, 0.5, 1.5].map((k) => cy + k * A * (mobile ? 0.95 : 1.05)),
      barX0: W * (mobile ? 0.06 : 0.1),
      barX1: W * (mobile ? 0.94 : 0.9),
    };
    buildGrid();
  };

  const text = (str, x, y, { size = 10, color = `rgba(${PAPER}, 0.5)`, align = 'left', weight = 500, font = MONO, baseline = 'alphabetic' } = {}) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, x, y);
  };

  const dashedV = (x, y0, y1, color, dash = [3, 4]) => {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y0);
    ctx.lineTo(x + 0.5, y1);
    ctx.stroke();
    ctx.restore();
  };

  const drawTrace = (f, alpha) => {
    if (alpha <= 0.01) return;
    const { A, cy, px } = L;
    const S = f * SPEED;
    const fadeW = W * 0.28;
    const step = 2;
    let key = null;
    let prev = null;

    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const strokeKey = (k) => {
      const [st, a] = k.split('|');
      ctx.strokeStyle = `rgba(${colorOf(st)}, ${(Number(a) / 10) * alpha})`;
      ctx.stroke();
    };

    for (let x = 0; x <= px; x += step) {
      const s = S - (px - x);
      const st = stateAt(s);
      const v = st === 'down' ? (hash(Math.floor(s / 4)) - 0.5) * 0.03 : beat(phaseOf(s));
      const y = cy - v * A;
      const a = Math.round(clamp(x / fadeW) * 10);
      const k = `${st}|${a}`;
      if (k !== key) {
        if (key !== null) {
          ctx.lineTo(x, y);
          strokeKey(key);
        }
        ctx.beginPath();
        ctx.moveTo(prev ? prev[0] : x, prev ? prev[1] : y);
        key = k;
      }
      ctx.lineTo(x, y);
      prev = [x, y];
    }
    if (key) strokeKey(key);

    // Per-beat readouts above each R-peak (latency when healthy, failure when down).
    const firstBeat = Math.floor((S - px) / PERIOD) - 1;
    const lastBeat = Math.floor(S / PERIOD) + 1;
    for (let k = firstBeat; k <= lastBeat; k++) {
      const sPeak = k * PERIOD + 0.29 * PERIOD;
      const x = px - (S - sPeak);
      if (x < W * 0.08 || x > px - 14) continue;
      const a = clamp(x / fadeW) * alpha;
      const st = stateAt(sPeak);
      if (st === 'down') {
        ctx.strokeStyle = `rgba(${DOWN}, ${0.8 * a})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x - 4, cy - 4);
        ctx.lineTo(x + 4, cy + 4);
        ctx.moveTo(x + 4, cy - 4);
        ctx.lineTo(x - 4, cy + 4);
        ctx.stroke();
        text('503', x, cy - 14, { color: `rgba(${DOWN}, ${0.75 * a})`, align: 'center', size: 9 });
      } else {
        text(`${latencyFor(k)}ms`, x, cy - A - 12, { color: `rgba(${st === 'rec' ? UP : PAPER}, ${0.42 * a})`, align: 'center', size: 9 });
      }
    }

    // Outage / recovery markers travelling with the trace.
    const markers = [
      { s: F_DOWN * SPEED, color: DOWN, label: 'FIRST FAILURE' },
      { s: F_UP * SPEED, color: UP, label: 'RECOVERED · 2m 22s DOWN' },
    ];
    for (const m of markers) {
      const x = px - (S - m.s);
      if (x < W * 0.04 || x > px) continue;
      const a = clamp(x / fadeW) * alpha;
      dashedV(x, cy - A * 1.55, cy + A * 0.7, `rgba(${m.color}, ${0.55 * a})`);
      text(m.label, x + 6, cy - A * 1.55 + 8, { color: `rgba(${m.color}, ${0.85 * a})`, size: 9 });
    }
  };

  const drawHead = (f, alpha) => {
    const { A, cy, px } = L;
    const S = f * SPEED;
    const st = stateAt(S);
    const v = st === 'down' ? 0 : beat(phaseOf(S));
    const y = cy - v * A;
    const c = st === 'down' ? DOWN : UP;

    // Playhead + "future" baseline
    dashedV(px, cy - A * 1.85, cy + A * 1.85, `rgba(${PAPER}, ${0.1 * alpha})`, [2, 5]);
    text('NOW', px, cy - A * 1.85 - 8, { color: `rgba(${PAPER}, ${0.35 * alpha})`, align: 'center', size: 9 });
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = `rgba(${PAPER}, ${0.07 * alpha})`;
    ctx.beginPath();
    ctx.moveTo(px + 8, cy + 0.5);
    ctx.lineTo(W, cy + 0.5);
    ctx.stroke();
    ctx.restore();

    const glow = ctx.createRadialGradient(px, y, 0, px, y, 34);
    glow.addColorStop(0, `rgba(${c}, ${0.35 * alpha})`);
    glow.addColorStop(1, `rgba(${c}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(px - 34, y - 34, 68, 68);
    ctx.fillStyle = `rgba(${c}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, y, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Status callout right after the failure lands.
    const callout = smooth(f, F_DOWN, F_DOWN + 6) * (1 - smooth(f, 92, 98));
    if (callout > 0.01) {
      text('503 SERVICE UNAVAILABLE', px + 14, cy + 4, { color: `rgba(${DOWN}, ${callout * alpha})`, size: L.mobile ? 9 : 11, weight: 600 });
    }
  };

  const drawConfirm = (f) => {
    const vis = smooth(f, 94, 100) * (1 - smooth(f, 190, 198));
    if (vis <= 0.01) return;
    const { A, cy, px } = L;

    ATTEMPTS.forEach((af, i) => {
      const p = (f - af) / 20;
      if (p > 0 && p < 1) {
        ctx.strokeStyle = `rgba(${DOWN}, ${(1 - p) * 0.75})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, cy, 6 + easeOut(p) * A * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Attempt boxes under the head
      const bx = px - 40 + i * 28;
      const by = cy + A * 1.3;
      const failed = f >= af + 8;
      ctx.strokeStyle = `rgba(${failed ? DOWN : PAPER}, ${(failed ? 0.9 : 0.3) * vis})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, 20, 20);
      if (failed) {
        ctx.fillStyle = `rgba(${DOWN}, ${0.22 * vis})`;
        ctx.fillRect(bx + 1, by + 1, 19, 19);
      }
      text(String(i + 1), bx + 10.5, by + 14, { color: `rgba(${failed ? DOWN : PAPER}, ${0.85 * vis})`, align: 'center', size: 10, weight: 600 });
      if (i < 2) text('+5s', bx + 24.5, by - 5, { color: `rgba(${PAPER}, ${0.3 * vis})`, align: 'center', size: 8 });
    });

    const fails = ATTEMPTS.filter((af) => f >= af + 8).length;
    const confirmed = f >= ATTEMPTS[2] + 10;
    const label = confirmed ? 'CONFIRMED DOWN · INCIDENT #0142 OPENED' : fails === 0 ? 'RE-CHECKING…' : `ATTEMPT ${fails}/3 FAILED`;
    text(label, px - 40, cy + A * 1.3 + 38, { color: `rgba(${confirmed ? DOWN : PAPER}, ${(confirmed ? 0.95 : 0.55) * vis})`, size: L.mobile ? 9 : 10, weight: 600 });
  };

  const bezier = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };

  const drawAlerts = (f) => {
    const vis = smooth(f, 138, 148) * (1 - smooth(f, 200, 210));
    if (vis <= 0.01) return;
    const { cy, px, nodeX, nodes, mobile } = L;
    const start = [px, cy];

    CHANNELS.forEach((ch, j) => {
      const end = [nodeX, nodes[j]];
      const mid = px + (nodeX - px) * 0.5;
      const c1 = [mid, cy];
      const c2 = [mid, nodes[j]];
      const t0 = 148 + j * 6;
      const p = clamp((f - t0) / 16);

      // Full route faintly, travelled part brighter
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${PAPER}, ${0.08 * vis})`;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const [x, y] = bezier(start, c1, c2, end, i / 40);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (p > 0) {
        ctx.strokeStyle = `rgba(${DOWN}, ${0.6 * vis})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        const steps = Math.max(1, Math.round(40 * p));
        for (let i = 0; i <= steps; i++) {
          const [x, y] = bezier(start, c1, c2, end, (i / steps) * p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (p < 1) {
          const [x, y] = bezier(start, c1, c2, end, p);
          const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
          g.addColorStop(0, `rgba(${DOWN}, ${0.9 * vis})`);
          g.addColorStop(1, `rgba(${DOWN}, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x - 14, y - 14, 28, 28);
        }
      }

      const arrived = p >= 1;
      ctx.fillStyle = arrived ? `rgba(${PAPER}, ${vis})` : `rgba(${INK}, ${vis})`;
      ctx.strokeStyle = `rgba(${PAPER}, ${(arrived ? 1 : 0.35) * vis})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(end[0], end[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (mobile) {
        text(ch.label, end[0] - 12, end[1] + 3, { color: `rgba(${PAPER}, ${(arrived ? 0.9 : 0.4) * vis})`, align: 'right', size: 8, weight: 600 });
      } else {
        text(ch.label, end[0] + 14, end[1] - 2, { color: `rgba(${PAPER}, ${(arrived ? 0.95 : 0.45) * vis})`, size: 11, weight: 600 });
        text(arrived ? `DELIVERED · ${ch.ms}ms` : ch.detail, end[0] + 14, end[1] + 12, {
          color: arrived ? `rgba(${UP}, ${0.8 * vis})` : `rgba(${PAPER}, ${0.3 * vis})`,
          size: 9,
        });
      }
    });
  };

  const drawRecord = (f) => {
    const vis = smooth(f, 210, 218);
    if (vis <= 0.01) return;
    const { A, cy, barX0, barX1, mobile } = L;
    const n = 90;
    const gap = mobile ? 1.5 : 2.5;
    const bw = (barX1 - barX0 - gap * (n - 1)) / n;
    const base = cy + A * 0.9;
    const maxH = A * 1.7;

    for (let i = 0; i < n; i++) {
      const t0 = 212 + i * 0.16;
      const p = smooth(f, t0, t0 + 10);
      if (p <= 0) continue;
      const isOutage = i === n - 1; // today: the outage we just watched
      const isWarn = i === 31 || i === 63;
      const color = isOutage ? DOWN : isWarn ? WARN : UP;
      const h = maxH * easeOut(p);
      ctx.fillStyle = `rgba(${color}, ${(isOutage || isWarn ? 0.95 : 0.78) * vis})`;
      const x = barX0 + i * (bw + gap);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, base - h, bw, h, Math.min(2, bw / 2));
      else ctx.rect(x, base - h, bw, h);
      ctx.fill();
    }

    const pct = 99.97 * easeOut(smooth(f, 214, 236));
    text('90-DAY RECORD · PUBLIC STATUS PAGE', barX0, base - maxH - 22, { color: `rgba(${PAPER}, ${0.5 * vis})`, size: mobile ? 8 : 10 });
    text(`${pct.toFixed(2)}%`, barX1, base - maxH - 18, {
      color: `rgba(${PAPER}, ${vis})`,
      align: 'right',
      size: mobile ? 34 : 56,
      weight: 400,
      font: SERIF,
    });
    text('90 DAYS AGO', barX0, base + 18, { color: `rgba(${PAPER}, ${0.3 * vis})`, size: 9 });
    text('TODAY', barX1, base + 18, { color: `rgba(${DOWN}, ${0.7 * vis})`, size: 9, align: 'right' });
  };

  const drawHud = (f) => {
    const S = f * SPEED;
    const st = stateAt(S);
    const k = Math.floor(S / PERIOD);
    const confirmed = f >= ATTEMPTS[2] + 10;

    // Frame counter — the sequence is literally 240 frames.
    // On phones the bottom edge belongs to the chapter rail, so the counter moves up beside the section label.
    const fcY = L.mobile ? 106 : H - 26;
    text(`FRAME ${String(f + 1).padStart(3, '0')} / ${FRAME_COUNT}`, W - (L.mobile ? 20 : 24), fcY, { color: `rgba(${PAPER}, 0.35)`, align: 'right', size: 10 });

    if (!L.wide) return;
    const x = W - 300;
    // Bottom-right, above the chapter rail — clear of the alert nodes and the top labels.
    let y = H - 92 - 5 * 22;
    const rows = [
      ['MONITOR', 'api.northwind.io/health'],
      ['METHOD', 'GET · every 30s'],
      ['STATUS', st === 'down' ? '503' : '200 OK', st === 'down' ? DOWN : UP],
      ['LATENCY', st === 'down' ? '—' : `${latencyFor(k)} ms`],
      [
        'INCIDENT',
        f < ATTEMPTS[2] + 10 ? '—' : f < F_UP ? '#0142 OPEN' : '#0142 RESOLVED',
        f < ATTEMPTS[2] + 10 ? null : f < F_UP ? DOWN : UP,
      ],
    ];
    const hudVis = 1 - smooth(f, 206, 214);
    if (hudVis <= 0.01) return;
    ctx.fillStyle = `rgba(${INK}, ${0.6 * hudVis})`;
    ctx.fillRect(x - 16, y - 22, 292, rows.length * 22 + 26);
    ctx.strokeStyle = `rgba(${PAPER}, ${0.08 * hudVis})`;
    ctx.strokeRect(x - 15.5, y - 21.5, 291, rows.length * 22 + 25);
    for (const [label, value, color] of rows) {
      text(label, x, y, { color: `rgba(${PAPER}, ${0.32 * hudVis})`, size: 10 });
      text(value, x + 86, y, { color: color ? `rgba(${color}, ${0.95 * hudVis})` : `rgba(${PAPER}, ${0.8 * hudVis})`, size: 10, weight: 600 });
      y += 22;
    }
    if (confirmed && f < F_UP) {
      text('● PAGING 4 CHANNELS', x, y + 2, { color: `rgba(${DOWN}, ${0.9 * hudVis})`, size: 10, weight: 600 });
    }
  };

  const draw = (frame) => {
    if (!L) return;
    const f = clamp(Math.round(frame), 0, FRAME_COUNT - 1);
    ctx.clearRect(0, 0, W, H);
    if (grid) ctx.drawImage(grid, 0, 0, W, H);

    // Brief red wash the instant the failure is confirmed.
    const wash = smooth(f, ATTEMPTS[2] + 6, ATTEMPTS[2] + 10) * (1 - smooth(f, ATTEMPTS[2] + 10, ATTEMPTS[2] + 30));
    if (wash > 0.01) {
      const g = ctx.createRadialGradient(L.px, L.cy, 0, L.px, L.cy, Math.max(W, H) * 0.6);
      g.addColorStop(0, `rgba(${DOWN}, ${0.12 * wash})`);
      g.addColorStop(1, `rgba(${DOWN}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const traceAlpha = 1 - smooth(f, 208, 222);
    drawTrace(f, traceAlpha);
    drawAlerts(f);
    drawConfirm(f);
    if (traceAlpha > 0.01) drawHead(f, traceAlpha);
    drawRecord(f);
    drawHud(f);
  };

  return { resize, draw };
}
