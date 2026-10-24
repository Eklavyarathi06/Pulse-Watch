import React, { useId, useMemo } from 'react';

/**
 * Tiny SVG sparkline (cheaper than a chart library per table row).
 * `points` = [{ responseTime: number|null, down?: boolean }]. Nulls become gaps.
 */
export function Sparkline({ points = [], status, width = 120, height = 32, className }) {
  const gradId = useId();
  const color = status === 'DOWN' ? 'var(--color-down)' : status === 'UP' ? 'var(--color-up)' : 'var(--color-fg-3)';

  const { line, area, downs, hasData } = useMemo(() => {
    const vals = points.map((p) => p?.responseTime).filter((v) => typeof v === 'number');
    if (vals.length < 1) return { line: '', area: '', downs: [], hasData: false };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1, max - min);
    const pad = 3;
    const n = Math.max(1, points.length - 1);
    const x = (i) => (i / n) * width;
    const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);

    let d = '';
    let a = '';
    let segStart = null;
    let lastX = 0;
    points.forEach((p, i) => {
      const v = p?.responseTime;
      if (typeof v !== 'number') {
        if (segStart !== null) {
          a += `L${lastX},${height}L${segStart},${height}Z`;
          segStart = null;
        }
        return;
      }
      const px = x(i).toFixed(1);
      const py = y(v).toFixed(1);
      if (segStart === null) {
        d += `M${px},${py}`;
        a += `M${px},${height}L${px},${py}`;
        segStart = px;
      } else {
        d += `L${px},${py}`;
        a += `L${px},${py}`;
      }
      lastX = px;
    });
    if (segStart !== null) a += `L${lastX},${height}L${segStart},${height}Z`;

    const downMarks = points.map((p, i) => (p?.down ? x(i) : null)).filter((v) => v !== null);
    return { line: d, area: a, downs: downMarks, hasData: true };
  }, [points, width, height]);

  if (!hasData) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--color-line-strong)" strokeDasharray="2 4" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {downs.map((dx) => (
        <rect key={dx} x={dx - 1.5} y="0" width="3" height={height} fill="var(--color-down)" opacity="0.35" />
      ))}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
