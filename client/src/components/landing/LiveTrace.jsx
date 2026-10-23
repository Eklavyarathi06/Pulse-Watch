import React, { useEffect, useRef } from 'react';
import { beat, latencyFor } from './outageFrames';

/**
 * Continuously running heartbeat strip (hero + auth page).
 * Pauses when off-screen or when the tab is hidden; static when reduced motion is requested.
 */
export function LiveTrace({ className, amplitude = 0.36, speed = 70, labels = true }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const PERIOD = 170;
    let W = 0;
    let H = 0;
    let raf = 0;
    let visible = true;
    let t0 = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now) => {
      const S = reduced ? 600 : ((now - t0) / 1000) * speed;
      const cy = H * 0.62;
      const A = H * amplitude;
      const head = W * 0.82;
      ctx.clearRect(0, 0, W, H);

      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      const grad = ctx.createLinearGradient(0, 0, head, 0);
      grad.addColorStop(0, 'rgba(237,232,223,0)');
      grad.addColorStop(0.35, 'rgba(237,232,223,0.35)');
      grad.addColorStop(1, 'rgba(237,232,223,0.95)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= head; x += 2) {
        const s = S - (head - x);
        const u = (((s % PERIOD) + PERIOD) % PERIOD) / PERIOD;
        const y = cy - beat(u) * A;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (labels) {
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const first = Math.floor((S - head) / PERIOD) - 1;
        for (let k = first; k <= Math.floor(S / PERIOD) + 1; k++) {
          const x = head - (S - (k * PERIOD + 0.29 * PERIOD));
          if (x < W * 0.15 || x > head - 10) continue;
          ctx.fillStyle = `rgba(237,232,223,${0.4 * Math.min(1, x / (W * 0.45))})`;
          ctx.fillText(`${latencyFor(k)}ms`, x, cy - A - 10);
        }
      }

      // Future baseline + head
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'rgba(237,232,223,0.12)';
      ctx.beginPath();
      ctx.moveTo(head + 8, cy);
      ctx.lineTo(W, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      const u = (((S % PERIOD) + PERIOD) % PERIOD) / PERIOD;
      const hy = cy - beat(u) * A;
      const g = ctx.createRadialGradient(head, hy, 0, head, hy, 26);
      g.addColorStop(0, 'rgba(70,212,131,0.45)');
      g.addColorStop(1, 'rgba(70,212,131,0)');
      ctx.fillStyle = g;
      ctx.fillRect(head - 26, hy - 26, 52, 52);
      ctx.fillStyle = '#46d483';
      ctx.beginPath();
      ctx.arc(head, hy, 3.4, 0, Math.PI * 2);
      ctx.fill();
    };

    const loop = (now) => {
      draw(now);
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    resize();
    raf = requestAnimationFrame(loop);
    document.fonts?.ready?.then(() => draw(performance.now()));

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && visible) raf = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', onVis);
    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [amplitude, speed, labels]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
