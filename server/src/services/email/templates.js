import { env } from '../../config/env.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minimal, client-safe HTML (tables + inline styles) in the PulseWatch ink/paper palette.
const layout = ({ preheader, heading, body, cta, ctaUrl, footnote }) => `<!doctype html>
<html><body style="margin:0;background:#0b0b0a;padding:32px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ede8df">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#121210;border:1px solid #2a2a26;border-radius:14px" cellspacing="0" cellpadding="0">
<tr><td style="padding:28px 32px 8px;font-size:15px;font-weight:600;letter-spacing:-0.02em">PulseWatch</td></tr>
<tr><td style="padding:8px 32px 0;font-size:24px;line-height:1.2;font-weight:500;letter-spacing:-0.03em">${esc(heading)}</td></tr>
<tr><td style="padding:14px 32px 0;font-size:15px;line-height:1.6;color:#a8a397">${body}</td></tr>
${cta ? `<tr><td style="padding:24px 32px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#ede8df;color:#0b0b0a;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:999px">${esc(cta)}</a></td></tr>
<tr><td style="padding:16px 32px 0;font-size:12px;line-height:1.5;color:#6f6b62">Or paste this link into your browser:<br><span style="word-break:break-all;color:#a8a397">${esc(ctaUrl)}</span></td></tr>` : ''}
<tr><td style="padding:24px 32px 28px;font-size:12px;color:#6f6b62">${esc(footnote || '')}</td></tr>
</table></td></tr></table></body></html>`;

export const verifyEmailTemplate = ({ name, token }) => {
  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirm your email for PulseWatch',
    text: `Hi ${name},\n\nConfirm your email address to start monitoring:\n${url}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
    html: layout({
      preheader: 'One click to confirm your email.',
      heading: 'Confirm your email',
      body: `Hi ${esc(name)}, confirm this address so PulseWatch can create monitors and send you alerts.`,
      cta: 'Confirm email',
      ctaUrl: url,
      footnote: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    }),
  };
};

export const resetPasswordTemplate = ({ name, token }) => {
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Reset your PulseWatch password',
    text: `Hi ${name},\n\nReset your password here:\n${url}\n\nThis link expires in 1 hour and can be used once. If you didn't ask for this, ignore this email — your password stays the same.`,
    html: layout({
      preheader: 'Reset link inside — valid for 1 hour.',
      heading: 'Reset your password',
      body: `Hi ${esc(name)}, someone (hopefully you) asked to reset the password for this account.`,
      cta: 'Choose a new password',
      ctaUrl: url,
      footnote: "Valid for 1 hour, single use. If you didn't ask for this, ignore this email — nothing changes.",
    }),
  };
};

export const inviteTemplate = ({ inviterName, workspaceName, role, token }) => {
  const url = `${env.APP_URL}/invite/${encodeURIComponent(token)}`;
  return {
    subject: `${inviterName} invited you to ${workspaceName} on PulseWatch`,
    text: `${inviterName} invited you to join "${workspaceName}" on PulseWatch as ${role}.\n\nAccept the invitation:\n${url}\n\nThis invitation expires in 7 days.`,
    html: layout({
      preheader: `Join ${workspaceName} on PulseWatch.`,
      heading: `Join ${workspaceName}`,
      body: `<strong style="color:#ede8df">${esc(inviterName)}</strong> invited you to monitor uptime with the <strong style="color:#ede8df">${esc(workspaceName)}</strong> team as ${esc(role)}.`,
      cta: 'Accept invitation',
      ctaUrl: url,
      footnote: 'This invitation expires in 7 days.',
    }),
  };
};

export const renewalReminderTemplate = ({ name, workspaceName, planName, expiresAt, daysLeft }) => {
  const url = `${env.APP_URL}/dashboard?tab=billing`;
  const when = new Date(expiresAt).toUTCString().slice(0, 16);
  const span = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;
  return {
    subject: `${planName} for ${workspaceName} ends ${span}`,
    text: `Hi ${name},\n\n${workspaceName}'s ${planName} plan ends ${span} (${when}).\nRenew now to keep your monitors, 30-second checks and team seats running without interruption — new time is added to the end of your current period.\n\nRenew: ${url}`,
    html: layout({
      preheader: `Renew before ${when} to avoid paused monitors.`,
      heading: `${planName} ends ${span}`,
      body: `Hi ${esc(name)}, ${esc(workspaceName)}’s ${esc(planName)} plan ends on <strong style="color:#ede8df">${esc(when)}</strong>. Renew now and the new period is added to the end of the current one — nothing is lost.`,
      cta: 'Renew plan',
      ctaUrl: url,
      footnote: 'If it lapses, monitors beyond the free limits are paused (never deleted) and resume when you renew.',
    }),
  };
};

export const planEndedTemplate = ({ name, workspaceName, planName, pausedCount }) => {
  const url = `${env.APP_URL}/dashboard?tab=billing`;
  return {
    subject: `${workspaceName} is back on the free plan`,
    text: `Hi ${name},\n\n${workspaceName}'s ${planName} plan has ended and the workspace is now on Hobby.${pausedCount ? `\n${pausedCount} monitor(s) beyond the free limit were paused — nothing was deleted.` : ''}\nRenew any time to restore everything automatically: ${url}`,
    html: layout({
      preheader: 'Renew any time to restore everything automatically.',
      heading: `${planName} has ended`,
      body: `Hi ${esc(name)}, ${esc(workspaceName)} is now on the free Hobby plan.${pausedCount ? ` <strong style="color:#ede8df">${pausedCount} monitor(s)</strong> beyond the free limit were paused — nothing was deleted.` : ''} Renew any time and they resume automatically.`,
      cta: 'Renew plan',
      ctaUrl: url,
      footnote: '',
    }),
  };
};

export const receiptTemplate =({ name, workspaceName, planName, cycle, amount, currency, paymentId, periodEnd }) => {
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100);
  const until = new Date(periodEnd).toUTCString().slice(0, 16);
  return {
    subject: `Payment received — ${planName} for ${workspaceName}`,
    text: `Hi ${name},\n\nThanks! We received ${money} for ${planName} (${cycle}) on ${workspaceName}.\nYour plan is active until ${until}.\nPayment ID: ${paymentId}\n\nManage billing: ${env.APP_URL}/dashboard?tab=billing`,
    html: layout({
      preheader: `${money} received — ${planName} is active.`,
      heading: `${planName} is active`,
      body: `Thanks, ${esc(name)}. We received <strong style="color:#ede8df">${esc(money)}</strong> for ${esc(planName)} (${esc(cycle)}) on ${esc(workspaceName)}. Your plan is active until <strong style="color:#ede8df">${esc(until)}</strong>.<br><br><span style="font-family:monospace;font-size:12px">Payment ID ${esc(paymentId)}</span>`,
      cta: 'View billing',
      ctaUrl: `${env.APP_URL}/dashboard?tab=billing`,
      footnote: 'Keep this email as your receipt.',
    }),
  };
};
