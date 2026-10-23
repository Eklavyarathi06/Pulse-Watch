import React, { useMemo, useState } from 'react';
import { Segmented } from '../Input';
import { fmtDurationLong } from '../../utils/format';

const SLAS = [99, 99.5, 99.9, 99.95, 99.99, 99.999];
const INTERVALS = [30, 60, 300, 900];
const YEAR = 365.25 * 86400;
const PERIODS = [
  { key: 'day', label: 'per day', s: 86400 },
  { key: 'week', label: 'per week', s: 7 * 86400 },
  { key: 'month', label: 'per month', s: YEAR / 12 },
  { key: 'year', label: 'per year', s: YEAR },
];

// Mirrors the server: 10s scheduler sweep, ≤5s jitter, 3 attempts with 5s between them.
const SWEEP = 10;
const JITTER = 5;
const ATTEMPTS = 3;
const BACKOFF = 5;
const FAST_FAIL = 0.3; // a 503 comes back in ~300ms

export function computeDetection({ interval, timeoutS, mode }) {
  const failTime = mode === 'timeout' ? timeoutS : FAST_FAIL;
  const confirm = ATTEMPTS * failTime + (ATTEMPTS - 1) * BACKOFF;
  return {
    best: confirm,
    average: interval / 2 + SWEEP / 2 + JITTER / 2 + confirm,
    worst: interval + SWEEP + JITTER + confirm,
  };
}

export function DowntimeCalculator() {
  const [sla, setSla] = useState(99.9);
  const [interval, setCheckInterval] = useState(60);
  const [mode, setMode] = useState('fast');
  const [timeoutS, setTimeoutS] = useState(10);
  const [mttr, setMttr] = useState(15);
  const [revenue, setRevenue] = useState(2000);

  const budget = useMemo(() => PERIODS.map((p) => ({ ...p, seconds: (1 - sla / 100) * p.s })), [sla]);
  const det = useMemo(() => computeDetection({ interval, timeoutS, mode }), [interval, timeoutS, mode]);

  const monthBudget = budget.find((b) => b.key === 'month').seconds;
  const perIncident = det.average + mttr * 60;
  const affordable = Math.floor(monthBudget / perIncident);
  const detectShare = Math.min(100, (det.worst / monthBudget) * 100);
  const atRisk = (monthBudget / 3600) * revenue;

  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-[1.05fr_1fr]">
      {/* Inputs */}
      <div className="space-y-8 bg-raised p-6 md:p-10">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <label className="text-sm text-fg-2">Your uptime promise (SLA)</label>
            <span className="font-mono text-sm text-fg">{sla}%</span>
          </div>
          <Segmented
            ariaLabel="SLA"
            value={sla}
            onChange={setSla}
            options={SLAS.map((v) => ({ value: v, label: `${v}` }))}
          />
        </div>

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <label className="text-sm text-fg-2">Check interval</label>
            <span className="font-mono text-sm text-fg">{interval < 60 ? `${interval}s` : `${interval / 60} min`}</span>
          </div>
          <Segmented
            ariaLabel="Check interval"
            value={interval}
            onChange={setCheckInterval}
            options={INTERVALS.map((v) => ({ value: v, label: v < 60 ? `${v}s` : `${v / 60}m` }))}
          />
        </div>

        <div>
          <div className="mb-3 text-sm text-fg-2">How it fails</div>
          <Segmented
            ariaLabel="Failure mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fast', label: 'Error page (503)' },
              { value: 'timeout', label: 'Hangs (timeout)' },
            ]}
          />
          {mode === 'timeout' && (
            <div className="mt-4">
              <div className="mb-2 flex justify-between text-xs text-fg-3">
                <span>Request timeout</span>
                <span className="font-mono text-fg-2">{timeoutS}s</span>
              </div>
              <input type="range" min={1} max={30} value={timeoutS} onChange={(e) => setTimeoutS(Number(e.target.value))} className="w-full" aria-label="Request timeout in seconds" />
            </div>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex justify-between text-xs text-fg-3">
              <span>Time to fix, after the alert</span>
              <span className="font-mono text-fg-2">{mttr} min</span>
            </div>
            <input type="range" min={1} max={120} value={mttr} onChange={(e) => setMttr(Number(e.target.value))} className="w-full" aria-label="Minutes to fix" />
          </div>
          <div>
            <div className="mb-2 flex justify-between text-xs text-fg-3">
              <span>Revenue per hour</span>
              <span className="font-mono text-fg-2">${revenue.toLocaleString()}</span>
            </div>
            <input type="range" min={0} max={50000} step={250} value={revenue} onChange={(e) => setRevenue(Number(e.target.value))} className="w-full" aria-label="Revenue per hour" />
          </div>
        </div>
      </div>

      {/* Outputs */}
      <div className="flex flex-col bg-raised p-6 md:p-10">
        <div className="eyebrow mb-4">Downtime budget at {sla}%</div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          {budget.map((b) => (
            <div key={b.key} className="border-t border-line pt-3">
              <dt className="text-xs text-fg-3">{b.label}</dt>
              <dd className="mt-1 font-serif text-[clamp(1.5rem,2.6vw,2.1rem)] leading-none tabular">{fmtDurationLong(b.seconds)}</dd>
            </div>
          ))}
        </dl>

        <div className="eyebrow mb-4 mt-10">Time until PulseWatch pages you</div>
        <div className="grid grid-cols-3 gap-4">
          {[
            ['best', 'Best case'],
            ['average', 'Typical'],
            ['worst', 'Worst case'],
          ].map(([k, label]) => (
            <div key={k} className="border-t border-line pt-3">
              <div className="text-xs text-fg-3">{label}</div>
              <div className="mt-1 font-mono text-lg tabular text-fg">{fmtDurationLong(det[k])}</div>
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-3 pt-10 text-[15px] leading-relaxed text-fg-2">
          <p>
            Worst-case detection uses <span className="text-fg">{detectShare.toFixed(detectShare < 1 ? 2 : 1)}%</span> of a month’s budget before anyone even knows.
            {' '}You can absorb <span className={affordable < 1 ? 'text-down' : 'text-fg'}>{affordable} incident{affordable === 1 ? '' : 's'}</span> a month at {mttr}-minute fixes.
          </p>
          <p className="text-sm text-fg-3">
            Revenue exposed if you use the whole monthly budget: <span className="font-mono text-fg-2">${Math.round(atRisk).toLocaleString()}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
