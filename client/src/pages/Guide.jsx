import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUp } from 'lucide-react';
import { Logo } from '../components/Logo';
import { StatusDot } from '../components/StatusPill';
import { cn } from '../components/Button';

/*
 * "PulseWatch, explained simply" — written so anyone who can read can understand it.
 * Short sentences, everyday words, one idea per paragraph.
 */

const TOC = [
  ['what', 'What is PulseWatch?'],
  ['why', 'Why would I need it?'],
  ['how', 'How does it work?'],
  ['words', 'Words you will see'],
  ['start', 'Getting started, step by step'],
  ['own', 'Proving a website is yours'],
  ['key', 'Adding an API key'],
  ['daily', 'Using it every day'],
  ['red', 'What to do when something turns red'],
  ['team', 'Working with your team'],
  ['status', 'Your public status page'],
  ['safe', 'Is my information safe?'],
  ['plans', 'Plans and paying'],
  ['faq', 'Quick questions'],
];

function Section({ id, n, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-12">
      <div className="eyebrow mb-3">{String(n).padStart(2, '0')}</div>
      <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] font-medium leading-[1.1] tracking-[-0.035em]">{title}</h2>
      <div className="mt-6 space-y-5 text-[17px] leading-[1.75] text-fg-2">{children}</div>
    </section>
  );
}

function Picture({ children, caption }) {
  return (
    <figure className="my-2 rounded-2xl border border-line bg-raised p-6">
      {children}
      {caption && <figcaption className="mt-4 text-sm text-fg-3">{caption}</figcaption>}
    </figure>
  );
}

function Steps({ items }) {
  return (
    <ol className="space-y-4">
      {items.map(([title, body], i) => (
        <li key={title} className="flex gap-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-sm text-fg">{i + 1}</span>
          <div>
            <div className="font-medium text-fg">{title}</div>
            <div className="mt-1">{body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Word({ term, children }) {
  return (
    <div className="border-t border-line py-4 first:border-t-0 sm:grid sm:grid-cols-[180px_1fr] sm:gap-6">
      <dt className="font-medium text-fg">{term}</dt>
      <dd className="mt-1 sm:mt-0">{children}</dd>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div className="rounded-xl border border-up/25 bg-up/[0.06] px-5 py-4 text-[16px] text-fg">
      <span className="mr-2 font-mono text-xs uppercase tracking-widest text-up">Tip</span>
      {children}
    </div>
  );
}

export default function GuidePage() {
  const [active, setActive] = useState('what');
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    document.title = 'PulseWatch, explained simply';
    const onScroll = () => {
      setShowTop(window.scrollY > 800);
      let current = TOC[0][0];
      for (const [id] of TOC) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 140) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.title = 'PulseWatch — Uptime monitoring that never cries wolf';
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="PulseWatch home"><Logo /></Link>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="hidden px-3 py-2 text-[13px] text-fg-2 hover:text-fg sm:block">Sign in</Link>
            <Link to="/auth?mode=register" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-medium text-bg hover:bg-white">
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 pb-32 pt-14 lg:grid lg:grid-cols-[230px_1fr] lg:gap-16">
        {/* Contents */}
        <aside className="hidden lg:block">
          <nav className="sticky top-28" aria-label="Guide contents">
            <div className="eyebrow mb-4">On this page</div>
            <ul className="space-y-1.5 text-[13px]">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className={cn('block rounded-md px-2 py-1 transition-colors', active === id ? 'bg-raised-2 text-fg' : 'text-fg-3 hover:text-fg')}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="max-w-[720px]">
          <div className="eyebrow mb-5">The simple guide</div>
          <h1 className="text-[clamp(2.6rem,6vw,4.4rem)] font-medium leading-[0.98] tracking-[-0.045em]">
            PulseWatch, <span className="serif-i">explained simply.</span>
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-fg-2">
            No tech words needed. If you can read this sentence, you can understand everything on this page — and use PulseWatch in about five minutes.
          </p>

          <div className="mt-16 space-y-16">
            <Section id="what" n={1} title="What is PulseWatch?">
              <p>
                Think of your website like a <strong className="text-fg">shop</strong>. Customers can only buy things when the shop door is open.
              </p>
              <p>
                Sometimes the door gets stuck shut — the website breaks. Maybe the computer it lives on crashed. Maybe someone made a mistake. When that happens, customers see an error and leave. Often <strong className="text-fg">you don’t even know it happened</strong>.
              </p>
              <p>
                PulseWatch is like a <strong className="text-fg">friendly guard</strong> who walks up to your shop’s door every minute, knocks, and checks that it opens. The moment the door is stuck, the guard calls you — so you can fix it before many customers notice.
              </p>
              <Picture caption="Every dot is one knock. Green means the door opened. Red means it was stuck.">
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from({ length: 28 }, (_, i) => (
                    <span key={i} className={cn('h-4 w-4 rounded-full', i >= 18 && i <= 21 ? 'bg-down' : 'bg-up')} />
                  ))}
                </div>
              </Picture>
              <p>
                It doesn’t only watch websites. It can also watch the hidden parts of an app — called <strong className="text-fg">APIs</strong> — which are like the kitchen behind a restaurant. Customers never see the kitchen, but if it stops, nobody gets food.
              </p>
            </Section>

            <Section id="why" n={2} title="Why would I need it?">
              <ul className="space-y-3">
                {[
                  ['You find out first.', 'Not from an angry customer, not hours later — within about a minute.'],
                  ['You lose less money.', 'Every minute your site is broken, people can’t buy, sign up or log in. Finding out fast means fixing fast.'],
                  ['No false alarms.', 'PulseWatch knocks three times before it calls you. One tiny hiccup won’t wake you up at 3 a.m. for nothing.'],
                  ['Your team knows too.', 'Alerts can go to Slack, Discord, email, or any app you use — so the right person sees it.'],
                  ['Your customers stay calm.', 'A public status page shows them “we know, we’re fixing it”, so they don’t flood you with messages.'],
                  ['You can prove you’re reliable.', 'PulseWatch keeps a 90-day record of how often you were up. Great for showing clients and bosses.'],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-3">
                    <StatusDot status="UP" size={8} className="mt-2.5" />
                    <span><strong className="text-fg">{t}</strong> {b}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="how" n={3} title="How does it work?">
              <p>Here is everything that happens, in order:</p>
              <Steps
                items={[
                  ['You tell PulseWatch what to watch.', 'You paste the web address (like https://myshop.com). That’s it.'],
                  ['PulseWatch knocks on it again and again.', 'Every 30 seconds to 15 minutes — you choose. Each knock is called a “check”.'],
                  ['It looks at the answer.', 'Did the page open? Did it open fast? Does it still show the words it should? If yes → green. If not → it tries again.'],
                  ['It knocks three times before deciding.', 'If the first knock fails, it waits 5 seconds and tries again, then once more. Only if all three fail is your site called “down”.'],
                  ['It calls you.', 'It sends a message to the places you picked — Slack, Discord, email, or a webhook.'],
                  ['It keeps checking.', 'The moment your site works again, it sends a second message: “It’s back! It was down for 4 minutes.”'],
                  ['It writes everything down.', 'Every check, every problem and how long it lasted is saved, so you can look back any time.'],
                ]}
              />
              <Tip>The three-knock rule is why we say PulseWatch “never cries wolf”. A real problem gets reported. A tiny blip doesn’t.</Tip>
            </Section>

            <Section id="words" n={4} title="Words you will see">
              <p>These are the only special words in PulseWatch:</p>
              <dl className="rounded-2xl border border-line bg-raised px-6 py-2">
                <Word term="Monitor">One thing being watched — for example, your homepage. You can have many monitors.</Word>
                <Word term="Check">One knock. PulseWatch does a check, writes down the answer, waits, and does the next one.</Word>
                <Word term={<span className="flex items-center gap-2"><StatusDot status="UP" size={8} /> Up</span>}>Working fine. The door opened.</Word>
                <Word term={<span className="flex items-center gap-2"><StatusDot status="DOWN" size={8} /> Down</span>}>Broken. Three knocks in a row failed.</Word>
                <Word term={<span className="flex items-center gap-2"><StatusDot status="PENDING" size={8} /> Checking</span>}>Just added — the first check is still running.</Word>
                <Word term={<span className="flex items-center gap-2"><StatusDot status="PAUSED" size={8} /> Paused</span>}>You told it to stop watching for now. No alerts are sent.</Word>
                <Word term="Incident">A problem, from the moment the site went down until it came back. Like a note in a diary: “Down from 3:12 to 3:16.”</Word>
                <Word term="Alert channel">Where PulseWatch sends its warnings — a Slack channel, a Discord channel, an email address, or a webhook.</Word>
                <Word term="Uptime">How much of the time your site worked, as a percentage. 100% means it never broke. 99.9% means it was broken for about 43 minutes in a month.</Word>
                <Word term="Response time">How long your site took to answer, in milliseconds (ms). 1,000 ms = 1 second. Smaller is faster.</Word>
                <Word term="Status page">A public web page that shows your customers whether your services are working.</Word>
                <Word term="Workspace">Your company’s space inside PulseWatch. Your monitors, team, alerts and plan all live in it.</Word>
              </dl>
            </Section>

            <Section id="start" n={5} title="Getting started, step by step">
              <Steps
                items={[
                  ['Create your account.', <>Click <strong className="text-fg">Start free</strong>. Type your name, your company name, your email and a strong password. No card needed.</>],
                  ['Confirm your email.', 'We send you an email with a button. Click it. This proves the email is really yours.'],
                  ['Prove the website is yours.', <>Open <strong className="text-fg">Domains</strong>, add your domain (like myshop.com) and follow the copy-paste steps. PulseWatch only watches websites your company owns.</>],
                  ['Add your first monitor.', <>Click <strong className="text-fg">New monitor</strong>. Paste your website address, give it a name like “My shop”, and choose how often to check. Click <strong className="text-fg">Start monitoring</strong>. Within seconds you’ll see a green or red dot.</>],
                  ['Tell PulseWatch where to warn you.', <>Open <strong className="text-fg">Alerts → Add channel</strong>. Pick Slack, Discord, email or webhook, paste the address, and press <strong className="text-fg">Save &amp; send test</strong>. If the test message arrives, it works.</>],
                  ['Connect the two.', <>Open your monitor, click <strong className="text-fg">Edit</strong>, and tick the alert channel you just made. Now problems with that website go to that place.</>],
                  ['Turn on two-step sign-in.', <>Go to <strong className="text-fg">Security</strong> and set up two-factor authentication with an app on your phone. Even if someone steals your password, they still can’t get in.</>],
                  ['(Optional) Invite your team and share a status page.', 'See the sections below.'],
                ]}
              />
              <Tip>Want to try it before signing up? On the sign-in page, click <strong>Explore the demo workspace</strong> (available on test servers).</Tip>
            </Section>

            <Section id="own" n={6} title="Proving a website is yours">
              <p>
                PulseWatch only watches websites that belong to <strong className="text-fg">your</strong> company. Before you can add a monitor, you prove you own the domain — just once.
              </p>
              <p>
                This protects everyone: nobody can use PulseWatch to watch, test or bother another company’s website. And each domain can belong to only <strong className="text-fg">one</strong> company on PulseWatch — if a teammate already verified it, ask them to invite you instead.
              </p>
              <Steps
                items={[
                  ['Open “Domains” in your dashboard and add your domain.', 'For example: myshop.com. This also covers every part of it, like api.myshop.com.'],
                  ['Choose how to prove it.', <>Either add a small note (a <strong className="text-fg">TXT record</strong>) in the place where you bought your domain — GoDaddy, Cloudflare, Namecheap… — or upload a tiny text file to your website. PulseWatch shows you exactly what to copy and paste.</>],
                  ['Press “Verify now”.', 'PulseWatch looks for your note. If it finds it, the domain turns green: verified. DNS notes can take a few minutes to appear.'],
                ]}
              />
              <Steps
                items={[
                  ['Press “Test connection”.', 'PulseWatch knocks once to make sure your website’s firewall lets it in. If it can’t get an answer, it tells you exactly what to allow (visitors whose name starts with “PulseWatch/”).'],
                ]}
              />
              <Tip>Leave the note in place. PulseWatch re-checks once a day. If a domain stops being verified, its monitors pause by themselves and start again when it’s verified.</Tip>
            </Section>

            <Section id="key" n={7} title="Adding an API key">
              <p>
                Some APIs are locked, like a door that needs a key card. To check them, PulseWatch needs the key.
              </p>
              <Steps
                items={[
                  ['Verify the domain first.', 'Keys can only be sent to websites you’ve proven are yours (see above).'],
                  ['Open “New monitor” (or “Edit” on an existing one).', 'Paste the API address.'],
                  ['Find “Does this API need a key?” and pick the kind your API uses.', <><strong className="text-fg">Bearer token</strong> (most common — your API’s docs say “Authorization: Bearer …”), <strong className="text-fg">API key header</strong> (the docs name a header like X-API-Key), or <strong className="text-fg">Username &amp; password</strong>.</>],
                  ['Paste the key and save.', 'From now on every check carries the key — locked away, never shown again.'],
                ]}
              />
              <Tip>Not sure which kind? Look in your API’s documentation for the word “Authorization” or “API key”, or ask your developer.</Tip>
            </Section>

            <Section id="daily" n={8} title="Using it every day">
              <p>Most days you won’t need to do anything — PulseWatch works by itself. When you do open the dashboard:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>The <strong className="text-fg">big sentence at the top</strong> tells you the most important thing, like “All 3 active monitors are operational.”</li>
                <li>The <strong className="text-fg">four boxes</strong> show uptime, speed, open problems and how many monitors you use.</li>
                <li>Each <strong className="text-fg">row</strong> is one monitor. The little wavy line shows how fast it was over the last 24 hours.</li>
                <li><strong className="text-fg">Click a row</strong> to see everything about it: a speed chart, 90 days of history, every recent check and every past problem.</li>
              </ul>
              <p>Useful buttons:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li><strong className="text-fg">Check now</strong> — knock right away instead of waiting.</li>
                <li><strong className="text-fg">Pause</strong> — stop watching for a while (for example, during planned work), so you don’t get alerts you already expect.</li>
                <li><strong className="text-fg">Edit</strong> — change the address, the name, how often it checks, or where alerts go.</li>
              </ul>
            </Section>

            <Section id="red" n={9} title="What to do when something turns red">
              <Steps
                items={[
                  ['Don’t panic — read the reason.', 'Click the red monitor. PulseWatch tells you what went wrong in plain words, like “Timed out” (it was too slow), “Unexpected status” (it sent an error page), or “Keyword missing” (the page opened but looked wrong).'],
                  ['Tell the person who can fix it.', 'Usually your developer or hosting company. Send them the reason PulseWatch shows.'],
                  ['Let your customers know.', 'If your status page is published, it already shows the problem — share the link.'],
                  ['Wait for the green message.', 'When the site works again, PulseWatch sends “Recovered” and records exactly how long it was down.'],
                ]}
              />
            </Section>

            <Section id="team" n={10} title="Working with your team">
              <p>
                Open <strong className="text-fg">Team → Invite</strong> and type a teammate’s email. They get an email with a link to join your workspace. Everyone in a workspace sees the same monitors and problems.
              </p>
              <dl className="rounded-2xl border border-line bg-raised px-6 py-2">
                <Word term="Owner">The boss of the workspace. Can do everything, including paying and deleting the workspace.</Word>
                <Word term="Admin">Can manage monitors, alert channels and teammates.</Word>
                <Word term="Member">Can see everything, and add, edit, pause and check monitors.</Word>
              </dl>
              <p>One person can belong to several workspaces — switch between them from the box at the top-left of the dashboard.</p>
            </Section>

            <Section id="status" n={11} title="Your public status page">
              <p>
                A status page is a simple public page that says “Everything is working” or “We have a problem with X”. Customers can check it themselves instead of messaging you.
              </p>
              <p>
                It is <strong className="text-fg">private until you turn it on</strong>. Go to <strong className="text-fg">Status page</strong> in the dashboard, flip the switch, and copy the link. It only shows names and green/red status — never your web addresses or secrets. You can hide any monitor from it in that monitor’s settings.
              </p>
            </Section>

            <Section id="safe" n={12} title="Is my information safe?">
              <p>Yes. We built PulseWatch so that you can trust it with private things, like the secret keys some APIs need.</p>
              <ul className="list-disc space-y-2 pl-6">
                <li><strong className="text-fg">Secrets are locked in a safe.</strong> Web addresses, passwords in headers and request bodies are scrambled (encrypted) before they are saved. Anyone who stole our database would see only gibberish.</li>
                <li><strong className="text-fg">Nobody can read them back.</strong> After you save a secret, no screen shows it again — not to your teammates, not to your boss, and not to PulseWatch staff. You can only replace it.</li>
                <li><strong className="text-fg">Alerts hide secrets too.</strong> Messages show addresses like <code className="font-mono text-sm text-fg">?api_key=•••</code>.</li>
                <li><strong className="text-fg">Your account has strong locks.</strong> Two-step sign-in, automatic locking after wrong passwords, and a record of every important action in <strong className="text-fg">Security → Audit log</strong>.</li>
              </ul>
              <Tip>Use a long password you don’t use anywhere else, and turn on two-step sign-in. Those two things stop almost every account break-in.</Tip>
            </Section>

            <Section id="plans" n={13} title="Plans and paying">
              <dl className="rounded-2xl border border-line bg-raised px-6 py-2">
                <Word term="Hobby — free">5 monitors, checked every minute, 2 people. Great for small projects.</Word>
                <Word term="Pro — ₹999/month">50 monitors, checked every 30 seconds, 10 people.</Word>
                <Word term="Team — ₹2,999/month">200 monitors, checked every 30 seconds, 50 people.</Word>
              </dl>
              <p>
                Paying a year at once saves 20%. Upgrade any time from <strong className="text-fg">Billing</strong> with a card, UPI or net banking (handled safely by Razorpay — we never see your card).
              </p>
              <p>
                Plans are paid in advance for one month or one year and <strong className="text-fg">do not charge you again automatically</strong>. We email you 7 days and 1 day before it ends. If it ends, your workspace goes back to the free plan: extra monitors are paused (nothing is deleted) and come back the moment you renew.
              </p>
            </Section>

            <Section id="faq" n={14} title="Quick questions">
              {[
                ['Do I need to install anything?', 'No. PulseWatch runs on the internet. You only need a web browser.'],
                ['Do I need to change my website?', 'No. PulseWatch visits your website from the outside, just like a customer would.'],
                ['Will it slow down my website?', 'No. One small visit every minute or so is tiny compared to normal visitors.'],
                ['My website opens fine, but PulseWatch says it’s down. Why?', 'Some big websites use a “bot firewall” that blocks automatic visitors, so PulseWatch gets no answer. If it’s your website, ask your developer or hosting company to allow visitors whose name (User-Agent) starts with “PulseWatch/”. If it’s someone else’s site, they don’t allow monitoring.'],
                ['What if my website is only slow, not broken?', 'You choose a time limit (1 to 30 seconds). If your site takes longer, PulseWatch treats it as a problem.'],
                ['Can it watch a page that needs a login?', 'Yes — on a domain you’ve verified. Use “Does this API need a key?” in the monitor form. The key is stored encrypted and never shown again.'],
                ['Can I watch a website I don’t own?', 'No. PulseWatch only watches websites on domains your company has verified. This keeps every company’s websites safe from being watched or tested by strangers.'],
                ['What if I forget my password?', 'Click “Forgot password?” on the sign-in page. We email you a link that works once, for one hour.'],
                ['What if I lose my phone with the authenticator app?', 'Use one of the recovery codes you saved when you turned on two-step sign-in. Each works once.'],
                ['Can I stop or delete everything?', 'Yes. You can pause any monitor, delete it, or delete your whole account from Settings.'],
              ].map(([q, a]) => (
                <div key={q} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                  <div className="font-medium text-fg">{q}</div>
                  <div className="mt-1">{a}</div>
                </div>
              ))}
            </Section>

            <div className="rounded-3xl border border-line bg-raised p-8 md:p-10">
              <h2 className="text-3xl font-medium tracking-[-0.035em]">Ready? It takes about a <span className="serif-i">minute.</span></h2>
              <p className="mt-3 text-fg-2">Free forever for small projects. No card needed.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/auth?mode=register" className="inline-flex h-12 items-center gap-2 rounded-full bg-fg px-6 text-[15px] font-medium text-bg hover:bg-white">
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/" className="inline-flex h-12 items-center rounded-full border border-line-strong px-6 text-[15px] hover:border-fg">Back to home</Link>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-raised-2 text-fg-2 shadow-2xl hover:text-fg"
          aria-label="Back to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
