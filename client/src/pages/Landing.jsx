import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ArrowRight, ArrowUpRight, Plus, Menu, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { Logo, LogoMark } from '../components/Logo';
import { cn } from '../components/Button';
import { LiveTrace } from '../components/landing/LiveTrace';
import { PulseSequence } from '../components/landing/PulseSequence';
import { DowntimeCalculator } from '../components/landing/DowntimeCalculator';
import { SplitWords } from '../components/landing/Reveal';
import api from '../utils/api';

gsap.registerPlugin(ScrollTrigger);

/* ───────────────────────── content ───────────────────────── */

const FEATURES = [
  {
    n: '01',
    title: 'Three-strike confirmation',
    body: 'A dropped packet is not an outage. A monitor only turns red after three consecutive failed attempts, five seconds apart — so the 3 a.m. page is always real.',
    spec: '3 attempts · 5s apart',
  },
  {
    n: '02',
    title: 'Assertions, not just pings',
    body: 'Accept exactly the status codes you expect, require a keyword in the response body, and set a timeout anywhere from one to thirty seconds.',
    spec: 'status · keyword · timeout',
  },
  {
    n: '03',
    title: 'Real requests',
    body: 'GET, POST, PUT or HEAD with your own headers and request body. Watch the authenticated endpoint your customers actually use, not just the homepage.',
    spec: 'headers · body · 4 methods',
  },
  {
    n: '04',
    title: 'Four ways to wake you',
    body: 'Slack, Discord, email and plain JSON webhooks. Send a test from the dashboard before you trust it. Each incident alerts each channel exactly once.',
    spec: 'idempotent delivery',
  },
  {
    n: '05',
    title: 'A status page that answers for you',
    body: 'A public page with live status, 90 days of uptime and incident history. Share the link and stop replying “is it down?” in five places at once.',
    spec: '/status/your-workspace',
  },
  {
    n: '06',
    title: 'Hardened by default',
    body: 'Secrets are encrypted per record and write-only — nobody can read them back, not even your workspace owner. Two-factor sign-in, account lockout, an audit log, and SSRF guards that refuse private networks.',
    spec: 'AES-256-GCM · 2FA · audit log',
  },
];

const LOG_LINES = [
  'GET /health 200 118ms',
  'POST /v1/charges 201 342ms',
  'HEAD / 200 64ms',
  'GET /api/orders 200 201ms',
  'GET /status 503 — retry 1/3',
  'GET /status 200 133ms — recovered',
  'PUT /v2/sync 204 288ms',
  'GET /graphql 200 97ms',
  'GET /login 200 156ms · keyword ✓',
];

// Mirrors server/src/config/plans.js (prices are per month, in rupees).
const PLANS = [
  {
    name: 'Hobby',
    price: { monthly: 0, annual: 0 },
    tagline: 'For side projects that still deserve sleep.',
    features: ['5 monitors', 'Checks every 60 seconds', '5 alert channels', '2 team members', 'Public status page'],
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: { monthly: 999, annual: 799 },
    tagline: 'For products with paying customers.',
    features: ['50 monitors', 'Checks every 30 seconds', '25 alert channels', '10 team members', 'Everything in Hobby'],
    cta: 'Start free, upgrade in-app',
    featured: true,
  },
  {
    name: 'Team',
    price: { monthly: 2999, annual: 2399 },
    tagline: 'For companies that share the pager.',
    features: ['200 monitors', 'Checks every 30 seconds', '50 alert channels', '50 team members', 'Everything in Pro'],
    cta: 'Start free, upgrade in-app',
  },
];

const FAQS = [
  {
    q: 'How do you avoid false alarms?',
    a: 'Every failure is retried twice more, five seconds apart, before the monitor changes state. Only three consecutive failures open an incident, and only an incident sends alerts. A single slow response or dropped connection never pages anyone.',
  },
  {
    q: 'What exactly counts as “down”?',
    a: 'A timeout, a DNS failure, a refused or reset connection, a TLS/certificate error, a status code outside the set you accept, or — if you set one — a keyword missing from the response body. The reason is recorded on every check so you can see why.',
  },
  {
    q: 'Which alert channels are supported?',
    a: 'Slack incoming webhooks, Discord webhooks, email (via your SMTP provider) and generic JSON webhooks you can point at anything — Zapier, n8n, PagerDuty Events or your own API. Each channel can be tested from the dashboard and paused without deleting it.',
  },
  {
    q: 'Can I monitor endpoints that need authentication?',
    a: 'Yes. Add request headers such as an Authorization bearer token, choose GET, POST, PUT or HEAD, and send a request body. Header values are stored with the monitor and only ever sent to the URL you configured.',
  },
  {
    q: 'Can I monitor something on my private network?',
    a: 'Not from the hosted service — PulseWatch refuses to connect to private, loopback and link-local addresses so it cannot be abused to scan internal networks. Expose a public health endpoint instead. Self-hosted development builds can opt in for local testing.',
  },
  {
    q: 'Can my whole team use one account?',
    a: 'Each person gets their own login inside a shared company workspace. Invite teammates by email as admins or members; everyone sees the same monitors, incidents and status page, and you can belong to several workspaces.',
  },
  {
    q: 'Can I monitor any website?',
    a: 'No — only your own. A company proves it owns its domain once (a DNS record or a small file), and then monitors any website or API on it. Each domain can belong to only one company, and every check is re-verified at the moment it runs, so nobody can point PulseWatch at a site that isn’t theirs.',
  },
  {
    q: 'Can anyone at PulseWatch see my API keys and URLs?',
    a: 'No one can read them through PulseWatch — not your teammates, not your workspace owner, and there is no staff console that shows them. URLs, headers, request bodies and webhook addresses are encrypted with AES-256-GCM before they are stored, each under its own key, and are write-only after you save them. They are decrypted only in memory, for the moment a check runs. Alerts and status pages only ever show a masked URL.',
  },
  {
    q: 'How are accounts protected?',
    a: 'Passwords are hashed with bcrypt and checked against common-password lists, accounts lock after repeated failures, and you can turn on two-factor authentication with any authenticator app (with one-time recovery codes). Workspace owners can require 2FA for every member, and an audit log records sign-ins and every sensitive change.',
  },
  {
    q: 'What does the public status page show?',
    a: 'Nothing until you publish it — status pages are private by default. Once published it lists the monitors you choose by name, with current state, a 90-day uptime bar, ongoing incidents and the last two weeks of resolved ones. Monitored URLs are never shown.',
  },
  {
    q: 'Is there really a free plan?',
    a: 'Yes — five monitors with one-minute checks, every alert channel type, a teammate and a status page, with no card required. Paid plans raise the limits and allow 30-second checks; they are prepaid monthly or yearly through Razorpay.',
  },
];

const STATUS_SERVICES = ['Public API', 'Web dashboard', 'Webhook delivery'];

const seeded = (n) => {
  const x = Math.sin(n * 91.7 + 13.1) * 10000;
  return x - Math.floor(x);
};

/* ───────────────────────── page ───────────────────────── */

export default function Landing() {
  const rootRef = useRef(null);
  const lenisRef = useRef(null);
  const navigate = useNavigate();
  const { demoLogin } = useAuth();
  const toast = useToast();
  const [annual, setAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);

  // The demo workspace only exists on development servers.
  useEffect(() => {
    api.get('/auth/config').then((r) => setDemoEnabled(Boolean(r.data.demoLogin))).catch(() => setDemoEnabled(false));
  }, []);

  const launchDemo = async () => {
    setDemoLoading(true);
    try {
      await demoLogin();
      navigate('/dashboard');
    } catch (err) {
      toast.error('Demo unavailable', { description: err.message });
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let lenis = null;
    let tick = null;
    if (!reduced) {
      lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
      lenisRef.current = lenis;
      lenis.on('scroll', ScrollTrigger.update);
      tick = (time) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const ctx = gsap.context(() => {
      if (reduced) return;

      // Hero: words rise on load
      gsap.from('[data-hero] [data-word]', { yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: 0.06, delay: 0.15 });
      gsap.from('[data-hero-fade]', { opacity: 0, y: 16, duration: 1, ease: 'power3.out', stagger: 0.08, delay: 0.6 });

      // Hero drifts up and dims as you leave it
      gsap.to('[data-hero-inner]', {
        yPercent: -18,
        opacity: 0.15,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom top', scrub: true },
      });

      // Section headings: word-by-word reveals
      gsap.utils.toArray('[data-reveal]').forEach((el) => {
        if (el.closest('[data-hero]')) return;
        gsap.from(el.querySelectorAll('[data-word]'), {
          yPercent: 110,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.035,
          scrollTrigger: { trigger: el, start: 'top 88%' },
        });
      });

      gsap.utils.toArray('[data-fade]').forEach((el) => {
        gsap.from(el, { opacity: 0, y: 28, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } });
      });

      // Feature index: hairlines draw in, rows rise
      gsap.utils.toArray('[data-row]').forEach((row) => {
        gsap.from(row.querySelector('[data-rule]'), { scaleX: 0, transformOrigin: 'left', duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: row, start: 'top 92%' } });
        gsap.from(row.querySelectorAll('[data-cell]'), { opacity: 0, y: 20, duration: 0.9, ease: 'power3.out', stagger: 0.06, scrollTrigger: { trigger: row, start: 'top 92%' } });
      });

      // Status preview bars grow with scroll
      gsap.from('[data-status-bar]', {
        scaleY: 0,
        transformOrigin: 'bottom',
        ease: 'none',
        stagger: { each: 0.004, from: 'start' },
        scrollTrigger: { trigger: '[data-status-preview]', start: 'top 85%', end: 'top 30%', scrub: 0.6 },
      });

      // Big closing wordmark rises letter by letter
      gsap.from('[data-wordmark] span', {
        yPercent: 100,
        ease: 'none',
        stagger: 0.05,
        scrollTrigger: { trigger: '[data-wordmark]', start: 'top bottom', end: 'bottom bottom', scrub: 0.8 },
      });

      // Number counters
      gsap.utils.toArray('[data-count]').forEach((el) => {
        const end = Number(el.dataset.count);
        const decimals = Number(el.dataset.decimals || 0);
        const obj = { v: 0 };
        gsap.to(obj, {
          v: end,
          duration: 2,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 90%' },
          onUpdate: () => { el.textContent = obj.v.toFixed(decimals); },
        });
      });
    }, rootRef);

    // Fonts change line lengths; recompute trigger positions once they land.
    document.fonts?.ready?.then(() => ScrollTrigger.refresh());

    return () => {
      window.removeEventListener('scroll', onScroll);
      ctx.revert();
      if (tick) gsap.ticker.remove(tick);
      lenis?.destroy();
      lenisRef.current = null;
    };
  }, []);

  const scrollTo = (id) => {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    // Native smooth scrolling fights Lenis — let Lenis drive when it's running.
    if (lenisRef.current) lenisRef.current.scrollTo(el, { offset: id === 'anatomy' ? 0 : -64, duration: 1.6 });
    else el.scrollIntoView({ behavior: 'smooth' });
  };

  const NAV = [
    ['How it works', 'anatomy'],
    ['Features', 'features'],
    ['Calculator', 'calculator'],
    ['Pricing', 'pricing'],
    ['FAQ', 'faq'],
  ];

  return (
    <div ref={rootRef} className="grain relative min-h-screen bg-bg text-fg">
      {/* ─── NAV ─── */}
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-500',
          scrolled ? 'border-b border-line bg-bg/75 backdrop-blur-xl' : 'border-b border-transparent'
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-5 md:px-10">
          <Link to="/" aria-label="PulseWatch home"><Logo /></Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            {NAV.map(([label, id]) => (
              <button key={id} onClick={() => scrollTo(id)} className="link-underline text-[13px] text-fg-2 transition-colors hover:text-fg">
                {label}
              </button>
            ))}
            <Link to="/guide" className="link-underline text-[13px] text-fg-2 transition-colors hover:text-fg">Guide</Link>
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Link to="/auth" className="px-3 py-2 text-[13px] text-fg-2 transition-colors hover:text-fg">Sign in</Link>
            <Link to="/auth?mode=register" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition-colors hover:bg-white">
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <button className="rounded-lg p-2 text-fg-2 md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-line bg-bg/95 px-5 pb-6 pt-2 backdrop-blur-xl md:hidden">
            {NAV.map(([label, id]) => (
              <button key={id} onClick={() => scrollTo(id)} className="block w-full border-b border-line py-4 text-left text-lg">
                {label}
              </button>
            ))}
            <Link to="/guide" className="block w-full border-b border-line py-4 text-left text-lg">Guide — PulseWatch explained simply</Link>
            <div className="mt-5 flex gap-3">
              <Link to="/auth" className="flex-1 rounded-full border border-line-strong py-3 text-center text-sm">Sign in</Link>
              <Link to="/auth?mode=register" className="flex-1 rounded-full bg-fg py-3 text-center text-sm font-medium text-bg">Start free</Link>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* ─── HERO ─── */}
        <section data-hero className="relative flex min-h-[100svh] flex-col overflow-hidden">
          <div data-hero-inner className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-center px-5 pb-10 pt-32 md:px-10 md:pt-36">
            <div data-hero-fade className="eyebrow mb-8 flex items-center gap-3">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping-slow rounded-full bg-up" />
                <span className="relative h-2 w-2 rounded-full bg-up" />
              </span>
              Uptime &amp; API monitoring
            </div>

            <h1 className="max-w-[15ch] text-[clamp(3.1rem,9.6vw,9.5rem)] font-medium leading-[0.9] tracking-[-0.055em]">
              <SplitWords>Uptime monitoring that never</SplitWords>{' '}
              <SplitWords><span className="serif-i tracking-[-0.03em]">cries wolf.</span></SplitWords>
            </h1>

            <div className="mt-10 grid gap-8 md:mt-14 md:grid-cols-[minmax(0,520px)_1fr] md:items-end">
              <div data-hero-fade>
                <p className="text-pretty text-[17px] leading-relaxed text-fg-2 md:text-lg">
                  PulseWatch checks your websites and APIs around the clock, confirms every failure three times,
                  and only then tells Slack, Discord, email or your webhook. Real outages, never noise.
                </p>
                <Link to="/guide" className="mt-4 inline-flex items-center gap-1.5 text-sm text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                  New to this? Read the 5-minute plain-English guide <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div data-hero-fade className="flex flex-wrap items-center gap-3 md:justify-end">
                <Link to="/auth?mode=register" className="group inline-flex h-12 items-center gap-2 rounded-full bg-fg pl-6 pr-5 text-[15px] font-medium text-bg transition-colors hover:bg-white">
                  Start monitoring free
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </Link>
                {demoEnabled ? (
                  <button
                    onClick={launchDemo}
                    disabled={demoLoading}
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong px-6 text-[15px] text-fg transition-colors hover:border-fg disabled:opacity-50"
                  >
                    {demoLoading ? 'Opening demo…' : 'Explore the live demo'}
                  </button>
                ) : (
                  <Link to="/auth" className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong px-6 text-[15px] text-fg transition-colors hover:border-fg">
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div data-hero-fade className="relative h-[150px] w-full md:h-[190px]">
            <LiveTrace className="absolute inset-0 h-full w-full" />
          </div>
          <div className="border-y border-line">
            <div className="mx-auto grid max-w-[1400px] grid-cols-2 divide-x divide-line md:grid-cols-4">
              {[
                ['3', '', 'attempts before an alert'],
                ['30', 's', 'fastest check interval'],
                ['4', '', 'alert channels'],
                ['90', 'd', 'of public uptime history'],
              ].map(([v, unit, label]) => (
                <div key={label} className="px-5 py-6 md:px-10">
                  <div className="font-serif text-4xl tabular md:text-5xl"><span data-count={v}>{v}</span>{unit}</div>
                  <div className="mt-1 text-[13px] text-fg-3">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── LOG MARQUEE ─── */}
        <div className="mask-fade-x overflow-hidden border-b border-line py-4" aria-hidden="true">
          <div className="flex w-max animate-marquee gap-10 font-mono text-xs text-fg-3">
            {[...LOG_LINES, ...LOG_LINES].map((l, i) => (
              <span key={i} className={cn('whitespace-nowrap', l.includes('503') && 'text-down/80', l.includes('recovered') && 'text-up/80')}>
                <span className="mr-3 text-fg-3/50">{String((i % LOG_LINES.length) + 1).padStart(2, '0')}</span>{l}
              </span>
            ))}
          </div>
        </div>

        {/* ─── INTRO TO SEQUENCE ─── */}
        <section className="mx-auto max-w-[1400px] px-5 pb-10 pt-28 md:px-10 md:pt-40">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="eyebrow md:col-span-3">§ How it works</div>
            <div className="md:col-span-9">
              <h2 className="text-balance text-[clamp(2.2rem,5.4vw,4.8rem)] font-medium leading-[0.98] tracking-[-0.045em]">
                <SplitWords>What happens in the</SplitWords>{' '}
                <SplitWords><span className="serif-i">142 seconds</span></SplitWords>{' '}
                <SplitWords>between “it broke” and “it’s fixed”.</SplitWords>
              </h2>
              <p data-fade className="mt-8 max-w-[560px] text-[17px] leading-relaxed text-fg-2">
                Scroll through a real incident, frame by frame — from a healthy heartbeat to a confirmed outage,
                four alerts, and the recovery that lands in your 90-day record.
              </p>
            </div>
          </div>
        </section>

        <PulseSequence />

        {/* ─── FEATURE INDEX ─── */}
        <section id="features" className="mx-auto max-w-[1400px] px-5 py-28 md:px-10 md:py-40">
          <div className="mb-16 grid gap-10 md:mb-24 md:grid-cols-12">
            <div className="eyebrow md:col-span-3">§ Index</div>
            <h2 className="text-balance text-[clamp(2.2rem,5.4vw,4.8rem)] font-medium leading-[0.98] tracking-[-0.045em] md:col-span-9">
              <SplitWords>Six things it does</SplitWords>{' '}
              <SplitWords><span className="serif-i">properly.</span></SplitWords>
            </h2>
          </div>

          <ol>
            {FEATURES.map((f) => (
              <li key={f.n} data-row className="group relative">
                <div data-rule className="h-px w-full bg-line-strong" />
                <div className="grid gap-4 py-8 transition-colors duration-500 md:grid-cols-12 md:gap-10 md:py-10">
                  <div data-cell className="font-mono text-xs text-fg-3 md:col-span-1 md:pt-3">{f.n}</div>
                  <h3 data-cell className="text-[clamp(1.6rem,3vw,2.6rem)] font-medium leading-[1.05] tracking-[-0.035em] transition-transform duration-700 ease-out-expo group-hover:translate-x-2 md:col-span-5">
                    {f.title}
                  </h3>
                  <p data-cell className="max-w-[520px] text-[15px] leading-relaxed text-fg-2 md:col-span-4 md:pt-2">{f.body}</p>
                  <div data-cell className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3 md:col-span-2 md:pt-3 md:text-right">{f.spec}</div>
                </div>
              </li>
            ))}
            <div className="h-px w-full bg-line-strong" />
          </ol>
        </section>

        {/* ─── CALCULATOR ─── */}
        <section id="calculator" className="border-t border-line bg-raised/40">
          <div className="mx-auto max-w-[1400px] px-5 py-28 md:px-10 md:py-40">
            <div className="mb-14 grid gap-10 md:mb-20 md:grid-cols-12">
              <div className="eyebrow md:col-span-3">§ Do the math</div>
              <div className="md:col-span-9">
                <h2 className="text-balance text-[clamp(2.2rem,5.4vw,4.8rem)] font-medium leading-[0.98] tracking-[-0.045em]">
                  <SplitWords>“Three nines” is</SplitWords>{' '}
                  <SplitWords><span className="serif-i">43 minutes</span></SplitWords>{' '}
                  <SplitWords>a month. Spend them wisely.</SplitWords>
                </h2>
                <p data-fade className="mt-8 max-w-[600px] text-[17px] leading-relaxed text-fg-2">
                  Pick the uptime you promise and how often you check. The calculator uses the same timings as the
                  scheduler — sweep, jitter, three attempts, five-second backoff — to show how fast you’d really hear about it.
                </p>
              </div>
            </div>
            <div data-fade>
              <DowntimeCalculator />
            </div>
          </div>
        </section>

        {/* ─── STATUS PAGE PREVIEW ─── */}
        <section className="mx-auto max-w-[1400px] px-5 py-28 md:px-10 md:py-40">
          <div className="grid items-center gap-14 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="eyebrow mb-8">§ Status pages</div>
              <h2 className="text-balance text-[clamp(2.2rem,4.6vw,4rem)] font-medium leading-[0.98] tracking-[-0.045em]">
                <SplitWords>Answer “is it down?”</SplitWords>{' '}
                <SplitWords><span className="serif-i">before anyone asks.</span></SplitWords>
              </h2>
              <p data-fade className="mt-8 max-w-[460px] text-[17px] leading-relaxed text-fg-2">
                Every workspace gets a public page with live status, 90-day uptime per service and incident history.
                It updates itself from the same checks that page you — and it never reveals the URLs you monitor.
              </p>
            </div>

            <div data-status-preview className="panel overflow-hidden lg:col-span-7">
              <div className="flex items-center justify-between border-b border-line px-6 py-4">
                <div className="flex items-center gap-2.5 text-sm font-medium">
                  <LogoMark className="h-5 w-5" /> Northwind status
                </div>
                <span className="font-mono text-[11px] text-fg-3">status.northwind.io</span>
              </div>
              <div className="flex items-center gap-3 border-b border-line bg-up/[0.06] px-6 py-5">
                <span className="h-2.5 w-2.5 rounded-full bg-up" />
                <span className="text-[15px] font-medium">All systems operational</span>
                <span className="ml-auto font-mono text-xs text-fg-2">99.98% · 30d</span>
              </div>
              <div className="divide-y divide-line">
                {STATUS_SERVICES.map((name, si) => (
                  <div key={name} className="px-6 py-5">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span>{name}</span>
                      <span className="font-mono text-xs text-up">Operational</span>
                    </div>
                    <div className="flex h-8 items-end gap-[2px]">
                      {Array.from({ length: 90 }, (_, i) => {
                        const r = seeded(si * 97 + i);
                        const cls = r > 0.985 ? 'bg-down' : r > 0.955 ? 'bg-warn' : 'bg-up';
                        return <div key={i} data-status-bar className={cn('h-full flex-1 rounded-[1.5px] opacity-85', cls)} />;
                      })}
                    </div>
                    <div className="mt-2 flex justify-between font-mono text-[10px] text-fg-3">
                      <span>90 days ago</span>
                      <span>Today</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── PRICING ─── */}
        <section id="pricing" className="border-t border-line">
          <div className="mx-auto max-w-[1400px] px-5 py-28 md:px-10 md:py-40">
            <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
              <div>
                <div className="eyebrow mb-8">§ Pricing</div>
                <h2 className="text-[clamp(2.2rem,5.4vw,4.8rem)] font-medium leading-[0.98] tracking-[-0.045em]">
                  <SplitWords>Priced like a</SplitWords>{' '}
                  <SplitWords><span className="serif-i">utility.</span></SplitWords>
                </h2>
              </div>
              <div data-fade className="inline-flex rounded-full border border-line-strong p-1 text-[13px]">
                {[['Monthly', false], ['Annual · save 20%', true]].map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => setAnnual(val)}
                    className={cn('rounded-full px-4 py-2 transition-colors', annual === val ? 'bg-fg text-bg' : 'text-fg-2 hover:text-fg')}
                    aria-pressed={annual === val}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
              {PLANS.map((p) => {
                const price = annual ? p.price.annual : p.price.monthly;
                return (
                  <div key={p.name} data-fade className={cn('flex flex-col bg-bg p-8 md:p-10', p.featured && 'bg-raised')}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium">{p.name}</h3>
                      {p.featured && <span className="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-2">Most picked</span>}
                    </div>
                    <p className="mt-2 text-sm text-fg-3">{p.tagline}</p>
                    <div className="mt-10 flex items-baseline gap-1.5">
                      <span className="font-serif text-7xl leading-none tabular">₹{price.toLocaleString('en-IN')}</span>
                      <span className="text-sm text-fg-3">/ month</span>
                    </div>
                    <div className="mt-1 h-5 text-xs text-fg-3">{price > 0 && annual ? `billed ₹${(price * 12).toLocaleString('en-IN')} yearly` : price > 0 ? 'billed monthly' : ''}</div>
                    <ul className="mt-8 space-y-3 text-[15px] text-fg-2">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-3">
                          <span className="mt-[9px] h-px w-3 shrink-0 bg-fg-3" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/auth?mode=register"
                      className={cn(
                        'mt-10 inline-flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors',
                        p.featured ? 'bg-fg text-bg hover:bg-white' : 'border border-line-strong hover:border-fg'
                      )}
                    >
                      {p.cta}
                    </Link>
                  </div>
                );
              })}
            </div>
            <p data-fade className="mt-6 text-center text-[13px] text-fg-3">
              Every workspace starts on Hobby — no card needed. Upgrade any time from Billing with card, UPI or netbanking via Razorpay. Prices in INR.
            </p>
          </div>
        </section>

        {/* ─── FAQ ─── */}
        <section id="faq" className="border-t border-line">
          <div className="mx-auto grid max-w-[1400px] gap-12 px-5 py-28 md:grid-cols-12 md:px-10 md:py-40">
            <div className="md:col-span-4">
              <div className="eyebrow mb-8">§ Questions</div>
              <h2 className="text-[clamp(2.2rem,4.4vw,3.8rem)] font-medium leading-[0.98] tracking-[-0.045em]">
                <SplitWords>Asked, and</SplitWords>{' '}
                <SplitWords><span className="serif-i">answered.</span></SplitWords>
              </h2>
            </div>
            <div className="md:col-span-8">
              {FAQS.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div key={f.q} className="border-b border-line first:border-t">
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="flex w-full items-center justify-between gap-6 py-6 text-left"
                      aria-expanded={open}
                    >
                      <span className="text-[17px] md:text-lg">{f.q}</span>
                      <Plus className={cn('h-5 w-5 shrink-0 text-fg-3 transition-transform duration-500 ease-out-expo', open && 'rotate-45 text-fg')} />
                    </button>
                    <div className={cn('grid transition-[grid-template-rows] duration-500 ease-out-expo', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                      <div className="overflow-hidden">
                        <p className="max-w-[640px] pb-7 text-[15px] leading-relaxed text-fg-2">{f.a}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-[1400px] px-5 py-28 md:px-10 md:py-40">
            <h2 className="max-w-[16ch] text-[clamp(2.6rem,7vw,6.5rem)] font-medium leading-[0.93] tracking-[-0.05em]">
              <SplitWords>Sleep through the night.</SplitWords>{' '}
              <SplitWords><span className="serif-i">We’ll wake you if it matters.</span></SplitWords>
            </h2>
            <div data-fade className="mt-12 flex flex-wrap gap-3">
              <Link to="/auth?mode=register" className="group inline-flex h-12 items-center gap-2 rounded-full bg-fg pl-6 pr-5 text-[15px] font-medium text-bg hover:bg-white">
                Create a free workspace <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              {demoEnabled && (
                <button onClick={launchDemo} disabled={demoLoading} className="inline-flex h-12 items-center gap-2 rounded-full border border-line-strong px-6 text-[15px] hover:border-fg disabled:opacity-50">
                  {demoLoading ? 'Opening demo…' : 'Explore the live demo'} <ArrowUpRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="overflow-hidden border-t border-line">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-5 pt-16 md:grid-cols-12 md:px-10">
          <div className="md:col-span-5">
            <Logo />
            <p className="mt-4 max-w-[340px] text-sm leading-relaxed text-fg-3">
              Confirmed-failure uptime monitoring for websites and APIs.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm md:col-span-7 md:grid-cols-3">
            <div>
              <div className="eyebrow mb-4">Product</div>
              <ul className="space-y-2.5 text-fg-2">
                <li><Link to="/guide" className="hover:text-fg">Simple guide</Link></li>
                <li><button onClick={() => scrollTo('anatomy')} className="hover:text-fg">How it works</button></li>
                <li><button onClick={() => scrollTo('features')} className="hover:text-fg">Features</button></li>
                <li><button onClick={() => scrollTo('pricing')} className="hover:text-fg">Pricing</button></li>
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-4">Tools</div>
              <ul className="space-y-2.5 text-fg-2">
                <li><button onClick={() => scrollTo('calculator')} className="hover:text-fg">SLA calculator</button></li>
                {demoEnabled && <li><button onClick={launchDemo} className="hover:text-fg">Live demo</button></li>}
                <li><Link to="/terms" className="hover:text-fg">Terms</Link></li>
                <li><Link to="/privacy" className="hover:text-fg">Privacy</Link></li>
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-4">Account</div>
              <ul className="space-y-2.5 text-fg-2">
                <li><Link to="/auth" className="hover:text-fg">Sign in</Link></li>
                <li><Link to="/auth?mode=register" className="hover:text-fg">Create account</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div data-wordmark className="mx-auto mt-16 flex max-w-[1400px] select-none justify-between overflow-hidden px-3 text-[clamp(4rem,17.5vw,17rem)] font-semibold leading-[0.8] tracking-[-0.07em] text-fg/90" aria-hidden="true">
          {'PulseWatch'.split('').map((ch, i) => (
            <span key={i} className="inline-block">{ch}</span>
          ))}
        </div>
        <div className="mx-auto flex max-w-[1400px] flex-col justify-between gap-2 border-t border-line px-5 py-6 font-mono text-[11px] text-fg-3 md:flex-row md:px-10">
          <span>© {new Date().getFullYear()} PulseWatch</span>
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-up" /> All systems operational</span>
        </div>
      </footer>
    </div>
  );
}
