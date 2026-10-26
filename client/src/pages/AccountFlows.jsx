import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, MailCheck, Mail, RefreshCw, LogOut, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthShell, Notice } from '../components/AuthShell';
import { PasswordInput, StrengthMeter } from './Auth';
import api from '../utils/api';

/* ───────────── Forgot password ───────────── */

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting }, getValues } = useForm({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address') })),
  });

  const onSubmit = async ({ email }) => {
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={<>Forgot your <span className="serif-i">password?</span></>}
      subtitle="Enter the email you signed up with and we’ll send a link to choose a new one."
    >
      {sent ? (
        <div className="space-y-6">
          <Notice tone="success">
            If an account exists for <strong>{getValues('email')}</strong>, a reset link is on its way. It works once and expires in an hour.
          </Notice>
          <p className="text-sm text-fg-3">Nothing arriving? Check spam, or try again in a minute.</p>
          <Link to="/auth" className="inline-flex items-center gap-1.5 text-sm text-fg underline decoration-line-strong underline-offset-4">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Input label="Email" type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} error={errors.email?.message} />
          <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>
            Send reset link {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </Button>
          <p className="text-center text-sm text-fg-3">
            Remembered it? <Link to="/auth" className="text-fg underline decoration-line-strong underline-offset-4">Sign in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

/* ───────────── Reset password ───────────── */

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(
      z
        .object({
          password: z.string().min(10, 'At least 10 characters').max(200),
          confirm: z.string(),
        })
        .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match' })
    ),
  });

  const onSubmit = async ({ password }) => {
    setError('');
    try {
      const result = await resetPassword(token, password);
      if (result?.mfaRequired) {
        // Password changed; finish signing in with the second factor.
        navigate('/auth', { replace: true, state: { mfaTicket: result.mfaTicket } });
        return;
      }
      navigate('/dashboard', { replace: true, state: { toast: 'Password updated — you’re signed in.' } });
    } catch (err) {
      setError(err.message);
    }
  };

  if (!token) {
    return (
      <AuthShell eyebrow="Account recovery" title="Link incomplete">
        <Notice tone="error">This reset link is missing its token. Open the link from the email again, or request a new one.</Notice>
        <Link to="/forgot-password" className="mt-6 inline-block text-sm text-fg underline underline-offset-4">Request a new link</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={<>Choose a new <span className="serif-i">password.</span></>}
      subtitle="Every other device will be signed out once you save it."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {error && (
          <Notice tone="error">
            {error} <Link to="/forgot-password" className="underline underline-offset-2">Request a new link</Link>
          </Notice>
        )}
        <PasswordInput field={register('password')} error={errors.password?.message} label="New password" hint="min. 10 characters" autoComplete="new-password" />
        <StrengthMeter password={watch('password')} />
        <PasswordInput field={register('confirm')} error={errors.confirm?.message} label="Confirm password" autoComplete="new-password" />
        <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>Save password &amp; sign in</Button>
      </form>
    </AuthShell>
  );
}

/* ───────────── Verify email ───────────── */

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, devVerificationCode, verifyEmailCode, resendVerification, refresh, logout } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [tokenStatus, setTokenStatus] = useState(token ? 'working' : 'idle');
  const ran = useRef(false);

  // If a magic token is present in URL (from email link), auto-verify
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(async (r) => {
        setTokenStatus('done');
        setSuccessMsg(`${r.data?.email || 'Your email'} has been verified successfully!`);
        await refresh();
        setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
      })
      .catch((err) => {
        setTokenStatus('error');
        setError(err.message);
      });
  }, [token, refresh, navigate]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    const clean = code.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError('Please enter a 6-digit verification code.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await verifyEmailCode(clean);
      setSuccessMsg('Email verified successfully! Redirecting to dashboard...');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
    } catch (err) {
      setError(err.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setResending(true);
    try {
      await resendVerification();
      setCooldown(60);
      setSuccessMsg('A fresh verification code has been dispatched to your email.');
    } catch (err) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  if (tokenStatus === 'working') {
    return (
      <AuthShell eyebrow="Email confirmation" title="Confirming…">
        <div className="skeleton h-12 rounded-[10px]" />
      </AuthShell>
    );
  }

  if (tokenStatus === 'done' || successMsg.includes('Redirecting')) {
    return (
      <AuthShell eyebrow="Account active" title={<>You’re <span className="serif-i text-up">verified.</span></>}>
        <div className="space-y-6">
          <Notice tone="success">
            <CheckCircle2 className="mr-1.5 inline h-4 w-4" /> {successMsg || 'Your email address is confirmed.'}
          </Notice>
          <Button size="lg" className="w-full" onClick={() => navigate('/dashboard', { replace: true })}>
            Open Dashboard <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Security verification"
      title={<>Verify your <span className="serif-i">email address</span></>}
      subtitle={`Enter the 6-digit verification code sent to ${user?.email || 'your email'} to activate your account.`}
    >
      <form onSubmit={handleVerifyCode} className="space-y-5" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {successMsg && <Notice tone="success">{successMsg}</Notice>}

        {devVerificationCode && (
          <div className="rounded-[10px] border border-up/30 bg-up/10 p-3.5 text-xs text-up space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <span>⚡ Sandbox Mode (SMTP not configured on host):</span>
            </div>
            <p className="text-fg-2">
              Your 6-digit confirmation code is: <strong className="font-mono text-sm tracking-wider text-fg underline">{devVerificationCode}</strong>. Enter it below to activate your account.
            </p>
          </div>
        )}

        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-fg-3">
            6-Digit Confirmation Code
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            autoFocus
            className="w-full rounded-[10px] border border-line-strong bg-raised-2 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-fg outline-none transition-colors focus:border-fg focus:bg-raised-3"
          />
        </div>

        <Button type="submit" size="lg" className="w-full" isLoading={submitting} disabled={code.trim().length !== 6}>
          Verify & Unlock Dashboard {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>

        <div className="flex items-center justify-between pt-2 text-xs text-fg-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="inline-flex items-center gap-1 hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>

          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/auth', { replace: true });
            }}
            className="inline-flex items-center gap-1 hover:text-down"
          >
            <LogOut className="h-3.5 w-3.5" /> Use different email
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

/* ───────────── Accept invitation ───────────── */

export function AcceptInvitePage() {
  const { token } = useParams();
  const { user, isLoading, acceptInvite, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/auth/invites/${token}`)
      .then((r) => setInvite(r.data))
      .catch((err) => setError(err.message));
  }, [token]);

  // Signed out → send them to sign in / sign up with the invite attached.
  useEffect(() => {
    if (isLoading || user || !invite || invite.expired) return;
    navigate(`/auth?invite=${encodeURIComponent(token)}${invite.hasAccount ? '' : '&mode=register'}`, { replace: true });
  }, [isLoading, user, invite, token, navigate]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await acceptInvite(token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const wrongAccount = user && invite && user.email !== invite.email;

  return (
    <AuthShell
      eyebrow={invite ? `Invitation · ${invite.role}` : 'Invitation'}
      title={invite ? <>Join <span className="serif-i">{invite.workspaceName}</span></> : error ? 'Invitation unavailable' : 'Loading invitation…'}
      subtitle={invite ? `${invite.inviterName} invited ${invite.email} to monitor uptime with the team.` : undefined}
    >
      {error && <div className="mb-6"><Notice tone="error">{error}</Notice></div>}
      {!invite && !error && <div className="skeleton h-12 rounded-[10px]" />}
      {invite?.expired && <Notice tone="error">This invitation has expired. Ask {invite.inviterName} to send a new one.</Notice>}
      {invite && !invite.expired && user && (
        wrongAccount ? (
          <div className="space-y-5">
            <Notice tone="error">You’re signed in as {user.email}, but this invitation is for {invite.email}.</Notice>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={async () => {
                await logout();
                navigate(`/auth?invite=${encodeURIComponent(token)}${invite.hasAccount ? '' : '&mode=register'}`, { replace: true });
              }}
            >
              Sign out and continue as {invite.email}
            </Button>
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={accept} isLoading={busy}>
            Accept & open dashboard <ArrowRight className="h-4 w-4" />
          </Button>
        )
      )}
    </AuthShell>
  );
}
