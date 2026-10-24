import React, { useMemo, useState } from 'react';
import { cn } from './Button';
import { fmtDay, fmtDuration, fmtUptime } from '../utils/format';

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export const barColor = (stat) => {
  if (!stat || stat.uptimePercent === undefined || stat.uptimePercent === null) return 'bg-raised-3';
  if (stat.uptimePercent >= 99.9) return 'bg-up';
  if (stat.uptimePercent >= 98) return 'bg-warn';
  return 'bg-down';
};

/**
 * 90-day uptime strip. Hovering a day shows date, uptime and downtime.
 * Days with no data render as neutral ticks, not as green — absence of data is not uptime.
 */
export function UptimeBar({ dailyStats, days = 90, height = 34, className, compact = false }) {
  const [hover, setHover] = useState(null);

  const cells = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const map = new Map((dailyStats || []).map((s) => [dayKey(s.date), s]));
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - (days - 1 - i));
      return { date: d, stat: map.get(dayKey(d)) || null };
    });
  }, [dailyStats, days]);

  const active = hover !== null ? cells[hover] : null;

  return (
    <div className={cn('relative', className)}>
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${days}-day uptime history`}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(i)}
            className={cn(
              'h-full flex-1 rounded-[2px] transition-[opacity,transform] duration-150 origin-bottom',
              barColor(c.stat),
              hover === null ? 'opacity-90' : hover === i ? 'opacity-100 scale-y-[1.12]' : 'opacity-40'
            )}
          />
        ))}
      </div>

      {active && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-raised-2 px-3 py-2 text-xs shadow-2xl"
          style={{ left: `${((hover + 0.5) / days) * 100}%` }}
        >
          <div className="font-medium text-fg">
            {fmtDay(active.date)}
            {active.stat?.live && <span className="ml-1.5 font-mono text-[10px] text-warn">· today so far</span>}
          </div>
          {active.stat ? (
            <div className="mt-1 space-y-0.5 font-mono text-[11px] text-fg-2">
              <div>{fmtUptime(active.stat.uptimePercent, 3)} uptime</div>
              <div>{active.stat.downtimeSeconds > 0 ? `${fmtDuration(active.stat.downtimeSeconds)} down` : 'No downtime'}</div>
              {!compact && active.stat.incidentCount > 0 && <div>{active.stat.incidentCount} incident{active.stat.incidentCount > 1 ? 's' : ''}</div>}
            </div>
          ) : (
            <div className="mt-1 font-mono text-[11px] text-fg-3">No data recorded</div>
          )}
        </div>
      )}
    </div>
  );
}
