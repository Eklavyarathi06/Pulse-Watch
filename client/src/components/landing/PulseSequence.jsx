import React, { useEffect, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CHAPTERS, FRAME_COUNT, createSequence, smooth } from './outageFrames';

const CAPTIONS = [
  {
    kicker: '01 — Steady',
    title: <>Every thirty seconds, <span className="serif-i">a heartbeat.</span></>,
    body: 'PulseWatch requests your endpoint on a schedule and records the status code, the latency and — if you ask — whether the body still says what it should.',
  },
  {
    kicker: '02 — Failure',
    title: <>Then, at 03:12, <span className="serif-i text-down">a 503.</span></>,
    body: 'Timeouts, DNS failures, refused connections, TLS errors, the wrong status code, a missing keyword. Each one is classified — not just “down”.',
  },
  {
    kicker: '03 — Confirm',
    title: <>One failure is noise. <span className="serif-i">Three is an outage.</span></>,
    body: 'Before anyone gets paged, the check runs twice more, five seconds apart. Only a unanimous failure opens an incident. That is the whole trick to never crying wolf.',
  },
  {
    kicker: '04 — Alert',
    title: <>Everyone who needs to know, <span className="serif-i">knows.</span></>,
    body: 'Slack, Discord, email and plain JSON webhooks fire in parallel — exactly once per incident, retried with backoff if a channel hiccups.',
  },
  {
    kicker: '05 — Recover',
    title: <>Recovery is news, <span className="serif-i text-up">too.</span></>,
    body: 'The all-clear goes out with the exact downtime. Every day folds into a 90-day record your customers can read on your public status page.',
  },
];

export function PulseSequence() {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  const captionRefs = useRef([]);
  const railRefs = useRef([]);
  const counterRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return undefined;

    const seq = createSequence(canvas);
    seq.resize();

    let target = 0;
    let current = 0;
    let drawn = -1;
    let raf = 0;
    let running = false;

    const paintOverlays = (f) => {
      CHAPTERS.forEach((ch, i) => {
        const len = ch.end - ch.start + 1;
        const local = (f - ch.start) / len;
        const fadeIn = i === 0 ? 1 : smooth(local, -0.02, 0.14);
        const fadeOut = i === CHAPTERS.length - 1 ? 1 : 1 - smooth(local, 0.86, 1.0);
        const o = Math.max(0, Math.min(fadeIn, fadeOut));
        const el = captionRefs.current[i];
        if (el) {
          el.style.opacity = o.toFixed(3);
          el.style.transform = `translate3d(0, ${((1 - fadeIn) * 28 - (1 - fadeOut) * 18).toFixed(1)}px, 0)`;
          el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
        }
        const bar = railRefs.current[i];
        if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (f - ch.start + 1) / len)).toFixed(3)})`;
      });
      if (counterRef.current) counterRef.current.textContent = String(f + 1).padStart(3, '0');
    };

    const render = () => {
      // Ease toward the scroll target: smooth scrub, still lands on exact integer frames.
      current += (target - current) * 0.18;
      if (Math.abs(target - current) < 0.05) current = target;
      const f = Math.round(current);
      if (f !== drawn) {
        seq.draw(f);
        paintOverlays(f);
        drawn = f;
      }
      if (current !== target) raf = requestAnimationFrame(render);
      else running = false;
    };
    const kick = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        target = self.progress * (FRAME_COUNT - 1);
        kick();
      },
    });
    target = st.progress * (FRAME_COUNT - 1);
    current = target;

    const redraw = () => {
      seq.resize();
      drawn = -1;
      seq.draw(Math.round(current));
      paintOverlays(Math.round(current));
      drawn = Math.round(current);
    };
    redraw();

    // Canvas text uses web fonts — repaint once they've arrived.
    document.fonts?.ready?.then(redraw);

    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      st.kill();
      ro.disconnect();
    };
  }, []);

  return (
    <section ref={sectionRef} id="anatomy" className="relative" style={{ height: '620vh' }} aria-label="Anatomy of an outage">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

        <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between px-5 pt-24 md:px-10">
          <div className="eyebrow">§ Anatomy of an outage</div>
          <div className="eyebrow hidden md:block">Scroll to scrub · <span ref={counterRef} className="tabular text-fg-2">001</span>/240</div>
        </div>

        {/* Chapter captions */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-24 md:px-10 md:pb-28">
          <div className="relative min-h-[210px] max-w-[540px] md:min-h-[230px]">
            {CAPTIONS.map((c, i) => (
              <div
                key={c.kicker}
                ref={(el) => { captionRefs.current[i] = el; }}
                className="absolute inset-x-0 bottom-0 will-change-transform"
                style={{ opacity: i === 0 ? 1 : 0 }}
              >
                <div className="eyebrow mb-4 text-fg-2">{c.kicker}</div>
                <h3 className="text-balance text-[clamp(1.9rem,4.2vw,3.4rem)] font-medium leading-[1.02] tracking-[-0.035em]">{c.title}</h3>
                <p className="mt-4 max-w-[440px] text-pretty text-[15px] leading-relaxed text-fg-2">{c.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Chapter rail */}
        <div className="absolute inset-x-0 bottom-0 px-5 pb-8 md:px-10">
          <div className="grid grid-cols-5 gap-2">
            {CHAPTERS.map((ch, i) => (
              <div key={ch.id}>
                <div className="h-px w-full overflow-hidden bg-line-strong">
                  <div ref={(el) => { railRefs.current[i] = el; }} className="h-full origin-left bg-fg" style={{ transform: 'scaleX(0)' }} />
                </div>
                <div className="mt-2 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3 sm:block">{ch.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
