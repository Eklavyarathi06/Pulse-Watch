import React, { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, Receipt, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button, cn } from './Button';
import { Segmented } from './Input';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { loadRazorpay } from '../utils/razorpay';
import { fmtMoney, fmtDay, fmtInterval } from '../utils/format';

const RANK = { free: 0, pro: 1, team: 2 };

function Meter({ label, used, limit }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[13px]">
        <span className="text-fg-2">{label}</span>
        <span className="font-mono text-xs text-fg-3">{used} / {limit}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised-3">
        <div className={cn('h-full rounded-full transition-[width] duration-700', pct >= 100 ? 'bg-down' : pct >= 80 ? 'bg-warn' : 'bg-fg')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BillingPanel() {
  const { user, setWorkspace } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cycle, setCycle] = useState('annual');
  const [busyPlan, setBusyPlan] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/billing');
      setData(res.data);
      setError('');
      // Keep the header, limits and forms in step with what the server says the plan is.
      setWorkspace(res.data.workspace);
      if (res.data.reconciled > 0) {
        toast.success('Payment confirmed', { description: `${res.data.workspace.plan === 'team' ? 'Team' : 'Pro'} is now active.` });
      }
    } catch (err) {
      setError(err.message);
    }
  }, [setWorkspace, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const checkout = async (planId) => {
    setBusyPlan(planId);
    try {
      const [Razorpay, order] = await Promise.all([loadRazorpay(), api.post('/billing/order', { plan: planId, cycle }).then((r) => r.data)]);

      await new Promise((resolve) => {
        const rzp = new Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'PulseWatch',
          description: order.description,
          prefill: order.prefill,
          notes: { workspace: data.workspace.name },
          theme: { color: '#0b0b0a', backdrop_color: 'rgba(11,11,10,0.85)' },
          modal: {
            confirm_close: true,
            ondismiss: () => resolve(),
          },
          handler: async (response) => {
            try {
              const res = await api.post('/billing/verify', response);
              setWorkspace(res.data.workspace);
              toast.success(`${res.data.payment.plan === 'team' ? 'Team' : 'Pro'} is active`, {
                description: `Paid ${fmtMoney(res.data.payment.amount)} · until ${fmtDay(res.data.workspace.planExpiresAt)}`,
              });
            } catch (err) {
              toast.error('Payment received but not confirmed yet', { description: err.message });
            } finally {
              await load();
              resolve();
            }
          },
        });
        rzp.on('payment.failed', (resp) => {
          const reason = resp.error?.description || 'Payment failed';
          toast.error('Payment failed', { description: reason });
          api.post('/billing/failed', { orderId: order.orderId, paymentId: resp.error?.metadata?.payment_id, reason }).catch(() => {});
        });
        rzp.open();
      });
    } catch (err) {
      toast.error('Could not start checkout', { description: err.message });
    } finally {
      setBusyPlan(null);
      load();
    }
  };

  if (error && !data) {
    return <div className="rounded-[10px] border border-down/30 bg-down/[0.07] px-4 py-3 text-sm text-down">{error}</div>;
  }
  if (!data) {
    return <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-72 rounded-[14px]" />)}</div>;
  }

  const ws = data.workspace;
  const current = ws.plan;
  const paidActive = current !== 'free' && ws.planExpiresAt;
  const daysLeft = paidActive ? Math.max(0, Math.ceil((new Date(ws.planExpiresAt) - Date.now()) / 86400000)) : 0;
  const lapsed = ws.purchasedPlan !== 'free' && current === 'free';

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">Plan &amp; billing</h2>
          <p className="mt-1 text-sm text-fg-3">Plans are prepaid for 30 or 365 days and apply to the whole workspace. Payments are processed by Razorpay.</p>
        </div>
        {data.razorpay.testMode && (
          <span className="rounded-full border border-warn/30 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-warn">Razorpay test mode</span>
        )}
      </div>

      {/* Current plan + usage */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <div className="panel p-6">
          <div className="eyebrow mb-3">Current plan</div>
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-5xl leading-none">{data.plans.find((p) => p.id === current)?.name}</span>
            {paidActive && <span className="font-mono text-xs text-fg-3">{ws.billingCycle}</span>}
          </div>
          <p className="mt-4 text-sm text-fg-2">
            {paidActive ? (
              <>Active until <span className="text-fg">{fmtDay(ws.planExpiresAt)}</span> · {daysLeft} day{daysLeft === 1 ? '' : 's'} left. Renew any time — new time is added to the end.</>
            ) : lapsed ? (
              <span className="text-warn">Your paid plan ended. Monitors beyond the Hobby limits were paused — nothing was deleted. Renew to resume them.</span>
            ) : (
              'Free forever for small projects. Upgrade when you need more monitors, faster checks or a bigger team.'
            )}
          </p>
          {paidActive && daysLeft <= 7 && (
            <p className="mt-3 flex items-center gap-2 text-sm text-warn"><AlertTriangle className="h-4 w-4" /> Renews manually — renew before it ends to avoid paused monitors.</p>
          )}
        </div>
        <div className="panel space-y-4 p-6">
          <div className="eyebrow">Usage</div>
          <Meter label="Monitors" used={data.usage.monitors} limit={ws.limits.monitors} />
          <Meter label="Alert channels" used={data.usage.channels} limit={ws.limits.channels} />
          <Meter label="Team members" used={data.usage.members} limit={ws.limits.members} />
          <div className="flex justify-between text-[13px]">
            <span className="text-fg-2">Fastest check</span>
            <span className="font-mono text-xs text-fg-3">every {fmtInterval(ws.limits.minInterval)}</span>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="eyebrow">Plans</h3>
          <div className="w-64">
            <Segmented size="sm" ariaLabel="Billing cycle" value={cycle} onChange={setCycle} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual · save 20%' }]} />
          </div>
        </div>

        {!data.razorpay.enabled && (
          <div className="mb-4 rounded-[10px] border border-warn/30 bg-warn/[0.06] px-4 py-3 text-sm text-warn">
            Payments aren’t configured on this server yet. Add <code className="font-mono text-xs">RAZORPAY_KEY_ID</code> and <code className="font-mono text-xs">RAZORPAY_KEY_SECRET</code> to <code className="font-mono text-xs">server/.env</code> and restart.
          </div>
        )}
        {!data.canManage && (
          <div className="mb-4 rounded-[10px] border border-line-strong bg-raised-2 px-4 py-3 text-sm text-fg-2">Only the workspace owner can change the plan.</div>
        )}
        {data.canManage && !user.emailVerified && (
          <div className="mb-4 rounded-[10px] border border-line-strong bg-raised-2 px-4 py-3 text-sm text-fg-2">Confirm your email address to upgrade.</div>
        )}

        <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {data.plans.map((p) => {
            const isCurrent = p.id === current;
            const price = p.price[cycle];
            const perMonth = cycle === 'annual' ? Math.round(price / 12) : price;
            const downgrade = paidActive && RANK[p.id] < RANK[current];
            const canBuy = p.id !== 'free' && data.canManage && data.razorpay.enabled && user.emailVerified && !downgrade;
            const label = isCurrent ? (p.id === 'free' ? 'Current plan' : `Renew ${cycle === 'annual' ? '1 year' : '1 month'}`) : downgrade ? `After ${fmtDay(ws.planExpiresAt)}` : p.id === 'free' ? 'Included' : `Upgrade to ${p.name}`;
            return (
              <div key={p.id} className={cn('flex flex-col bg-bg p-7', isCurrent && 'bg-raised')}>
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-medium">{p.name}</h4>
                  {isCurrent && <span className="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-2">Current</span>}
                </div>
                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-serif text-5xl leading-none tabular">{fmtMoney(perMonth)}</span>
                  <span className="text-sm text-fg-3">/ mo</span>
                </div>
                <div className="mt-1 h-4 text-xs text-fg-3">{price > 0 && cycle === 'annual' ? `${fmtMoney(price)} billed yearly` : price > 0 ? 'billed monthly' : 'free forever'}</div>
                <ul className="mt-6 space-y-2.5 text-[14px] text-fg-2">
                  <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />{p.monitors} monitors</li>
                  <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />Checks every {fmtInterval(p.minInterval)}</li>
                  <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />{p.channels} alert channels</li>
                  <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />{p.members} team members</li>
                </ul>
                <Button
                  className="mt-8"
                  variant={isCurrent || p.id === 'free' ? 'outline' : 'primary'}
                  disabled={!canBuy}
                  isLoading={busyPlan === p.id}
                  onClick={() => checkout(p.id)}
                >
                  {p.id !== 'free' && !isCurrent && !downgrade && <CreditCard className="h-4 w-4" />}
                  {label}
                </Button>
                {!isCurrent && paidActive && RANK[p.id] > RANK[current] && (
                  <p className="mt-2 text-center text-[11px] text-fg-3">Unused {data.plans.find((x) => x.id === current)?.name} time is credited at checkout.</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-fg-3">
          <ShieldCheck className="h-3.5 w-3.5" /> Card, UPI, netbanking and wallets via Razorpay. PulseWatch never sees your card details.
        </p>
      </div>

      {/* History */}
      <div>
        <h3 className="eyebrow mb-4">Payment history</h3>
        {data.payments.length === 0 ? (
          <div className="panel flex items-center gap-3 px-5 py-6 text-sm text-fg-3"><Receipt className="h-4 w-4" /> No payments yet.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-4 py-2.5 font-normal">Date</th>
                  <th className="px-4 py-2.5 font-normal">Plan</th>
                  <th className="px-4 py-2.5 font-normal">Period</th>
                  <th className="px-4 py-2.5 text-right font-normal">Amount</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.payments.map((p) => (
                  <tr key={p._id}>
                    <td className="whitespace-nowrap px-4 py-3 text-fg-2">{fmtDay(p.paidAt || p.createdAt)}</td>
                    <td className="px-4 py-3 capitalize">{p.plan} <span className="text-fg-3">· {p.cycle}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-fg-3">
                      {p.periodStart ? `${fmtDay(p.periodStart)} → ${fmtDay(p.periodEnd)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular">{fmtMoney(p.amount, p.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider', p.status === 'paid' ? 'bg-up/10 text-up' : 'bg-down/10 text-down')} title={p.failureReason || ''}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-fg-3">{p.paymentId || p.orderId}{p.method ? ` · ${p.method}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
