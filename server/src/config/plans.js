// Single source of truth for plans and prices. Amounts are in paise (₹1 = 100 paise),
// which is what Razorpay expects. The client fetches this via GET /billing/plans.
export const PLANS = {
  free: {
    id: 'free',
    name: 'Hobby',
    monitors: 5,
    minInterval: 60,
    channels: 5,
    members: 2,
    price: { monthly: 0, annual: 0 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monitors: 50,
    minInterval: 30,
    channels: 25,
    members: 10,
    price: { monthly: 99900, annual: 958800 }, // ₹999/mo · ₹9,588/yr (₹799/mo)
  },
  team: {
    id: 'team',
    name: 'Team',
    monitors: 200,
    minInterval: 30,
    channels: 50,
    members: 50,
    price: { monthly: 299900, annual: 2878800 }, // ₹2,999/mo · ₹28,788/yr (₹2,399/mo)
  },
};

export const PLAN_RANK = { free: 0, pro: 1, team: 2 };
export const CYCLE_DAYS = { monthly: 30, annual: 365 };
export const CURRENCY = 'INR';

/** The plan a workspace is actually entitled to right now (paid plans lapse to free). */
export const effectivePlanId = (workspace) => {
  if (!workspace) return 'free';
  if (workspace.plan === 'free') return 'free';
  if (workspace.planExpiresAt && new Date(workspace.planExpiresAt).getTime() < Date.now()) return 'free';
  return workspace.plan in PLANS ? workspace.plan : 'free';
};

export const limitsFor = (workspace) => PLANS[effectivePlanId(workspace)];
