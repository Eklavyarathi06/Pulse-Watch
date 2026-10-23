import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

// Plain-language starting points. Have a lawyer review these before taking real customers' money.
const DOCS = {
  terms: {
    title: 'Terms of Service',
    sections: [
      ['The service', 'PulseWatch sends automated HTTP requests to URLs you configure, records the results and notifies the channels you choose. You may only monitor endpoints you own or are authorised to test.'],
      ['Your account', 'You are responsible for activity in your workspace and for keeping your password safe. Workspace owners control membership, billing and data deletion for their workspace.'],
      ['Acceptable use', 'Do not use PulseWatch to load-test, attack, scrape or probe systems you do not control, or to send unsolicited messages through alert channels. We may suspend workspaces that do.'],
      ['Plans and payment', 'Paid plans are prepaid for the period shown at checkout (30 days or 365 days) and are processed by Razorpay. When a period ends without renewal, the workspace returns to the free plan and monitors beyond its limits are paused — no data is deleted.'],
      ['Availability', 'We work hard to keep checks running, but monitoring is provided “as is” without a guarantee that every outage will be detected or every alert delivered.'],
      ['Ending your account', 'You can delete your account and owned workspaces at any time from Settings. Payment records are kept as required for accounting.'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['What we store', 'Your name, email address, a salted password hash, the monitors you configure (including any headers and request bodies you add), check results, incidents and alert-channel settings.'],
      ['How secrets are protected', 'Alert-channel webhook URLs and addresses are encrypted at rest with AES-256-GCM. Sessions use HttpOnly cookies. Public status pages never show monitored URLs.'],
      ['Retention', 'Raw check results are kept for about 25 hours and then rolled up into daily statistics, which are kept for up to one year.'],
      ['Payments', 'Card, UPI and bank details are entered on Razorpay’s checkout and never touch our servers. We store order and payment IDs, amounts and status.'],
      ['Email', 'We email you to verify your address, reset your password, deliver invitations, send receipts and — if you configure it — deliver monitoring alerts.'],
      ['Your choices', 'You can update your profile, export what you see in the dashboard, and delete your account at any time from Settings.'],
    ],
  },
};

export default function LegalPage({ doc }) {
  const d = DOCS[doc];
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-8">
        <Link to="/" aria-label="PulseWatch home"><Logo /></Link>
        <Link to={doc === 'terms' ? '/privacy' : '/terms'} className="text-[13px] text-fg-3 hover:text-fg">
          {doc === 'terms' ? 'Privacy Policy' : 'Terms of Service'}
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
        <div className="eyebrow mb-4">Legal</div>
        <h1 className="text-5xl font-medium tracking-[-0.045em]">{d.title}</h1>
        <p className="mt-4 text-sm text-fg-3">Last updated {new Date(2026, 9, 17).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <div className="mt-12 space-y-10">
          {d.sections.map(([h, p], i) => (
            <section key={h} className="grid gap-3 border-t border-line pt-6 md:grid-cols-[220px_1fr]">
              <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-fg-3">{String(i + 1).padStart(2, '0')} · {h}</h2>
              <p className="text-[15px] leading-relaxed text-fg-2">{p}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
