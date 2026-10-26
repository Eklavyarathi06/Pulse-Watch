import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AuthShell, Notice } from '../components/AuthShell';
import api from '../utils/api';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  company: z.string().trim().max(80).optional(),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'At least 10 characters').max(200),
});

export const strengthOf = (pw = '') => {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
};

export function StrengthMeter({ password }) {
  if (!password) return null;
  const strength = strengthOf(password);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-colors duration-300 ${
              i < strength ? (strength <= 1 ? 'bg-down' : strength === 2 ? 'bg-warn' : 'bg-up') : 'bg-raised-3'
            }`}
          />
        ))}
      </div>
      <span className="w-14 text-right font-mono text-[11px] text-fg-3">{['weak', 'weak', 'fair', 'good', 'strong'][strength]}</span>
    </div>
  );
}

export function PasswordInput({ field, error, label = 'Password', hint, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input label={label} hint={hint} type={show ? 'text' : 'password'} placeholder={placeholder} autoComplete={autoComplete} className="pr-11" {...field} error={error} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-[34px] p-1 text-fg-3 hover:text-fg"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Second sign-in step when the account has two-factor authentication on. */
function TwoFactorStep({ ticket, onDone, onCancel }) {
  const { verifyTwoFactor } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyTwoFactor(ticket, code.trim());
      onDone();
    } catch (err) {
      setError(err.message);
      setCode('');
      if (err.status === 401 && /expired/i.test(err.message)) onCancel(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="flex items-start gap-3 rounded-[10px] border border-line-strong bg-raised-2 px-4 py-3 text-sm text-fg-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-up" />
        {useRecovery
          ? 'Enter one of your recovery codes. Each code works once.'
          : 'Open your authenticator app and enter the 6-digit code for PulseWatch.'}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Input
        label={useRecovery ? 'Recovery code' : 'Authentication code'}
        value={code}
        onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder={useRecovery ? 'xxxx-xxxx-xxxx' : '123456'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        className="text-center font-mono text-lg tracking-[0.4em]"
      />
      <Button type="submit" size="lg" className="w-full" isLoading={busy} disabled={useRecovery ? code.trim().length < 8 : code.length !== 6}>
        Verify &amp; sign in
      </Button>
      <div className="flex justify-between text-[13px] text-fg-3">
        <button type="button" className="underline decoration-line-strong underline-offset-4 hover:text-fg" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}>
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <button type="button" className="hover:text-fg" onClick={() => onCancel()}>Start over</button>
      </div>
    </form>
  );
}

export function GoogleIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function AuthForm({ mode, invite, onDone, onMfa }) {
  const isLogin = mode === 'login';
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [authError, setAuthError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [searchParams] = useSearchParams();

  // Show error from Google OAuth redirect (e.g. ?error=google_cancelled)
  const googleError = searchParams.get('error');

  const {
    register: field,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(isLogin ? loginSchema : registerSchema),
    defaultValues: isLogin
      ? { email: invite?.email || '', password: '' }
      : { name: '', company: '', email: invite?.email || '', password: '' },
  });

  const pw = watch('password');

  // Check if Google OAuth is enabled on the server
  const [googleEnabled, setGoogleEnabled] = useState(false);
  useEffect(() => {
    api.get('/auth/config').then((r) => setGoogleEnabled(Boolean(r.data.googleEnabled))).catch(() => {});
  }, []);

  const onSubmit = async (data) => {
    setAuthError('');
    try {
      if (isLogin) {
        const result = await login({ email: data.email, password: data.password });
        if (result?.mfaRequired) return onMfa(result.mfaTicket);
        if (result?.user && !result?.user?.emailVerified) {
          navigate('/verify-email', { replace: true });
          return;
        }
      } else {
        await register({ ...data, company: data.company || undefined, inviteToken: invite?.token });
        navigate('/verify-email', { replace: true });
        return;
      }
      onDone();
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleGoogleClick = () => {
    setGoogleLoading(true);
    // Redirect to the server, which redirects to Google's real OAuth consent screen
    const apiBase = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    const googleUrl = apiBase
      ? `${apiBase.replace(/\/api\/v1$/, '')}/api/v1/auth/google`
      : '/api/v1/auth/google';
    window.location.href = googleUrl;
  };

  return (
    <div className="space-y-5">
      {/* Google OAuth Button — real redirect, not a modal */}
      {googleEnabled && (
        <button
          type="button"
          onClick={handleGoogleClick}
          disabled={googleLoading}
          className="relative flex w-full items-center justify-center gap-3 rounded-[10px] border border-line-strong bg-raised-2 px-4 py-3 text-sm font-medium text-fg shadow-sm transition-all hover:bg-raised-3 hover:border-fg/40 disabled:opacity-60"
        >
          <GoogleIcon className="h-4 w-4 shrink-0" />
          <span>{googleLoading ? 'Redirecting to Google…' : `${isLogin ? 'Sign in' : 'Sign up'} with Google`}</span>
        </button>
      )}

      {/* Divider */}
      {googleEnabled && (
        <div className="relative flex items-center justify-center">
          <div className="w-full border-t border-line" />
          <span className="absolute bg-[#121210] px-3 font-mono text-[11px] uppercase tracking-wider text-fg-3">
            or continue with email
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {authError && <Notice tone="error">{authError}</Notice>}
        {googleError === 'google_cancelled' && <Notice tone="error">Google sign-in was cancelled. Please try again.</Notice>}
        {googleError === 'google_failed' && <Notice tone="error">Google sign-in failed. Please try again or use email.</Notice>}

        {!isLogin && <Input label="Your name" placeholder="Ada Lovelace" autoComplete="name" {...field('name')} error={errors.name?.message} />}
        {!isLogin && !invite && (
          <Input label="Company or team" hint="optional" placeholder="Acme Inc." autoComplete="organization" {...field('company')} error={errors.company?.message} />
        )}

        <Input
          label="Work email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          readOnly={Boolean(invite)}
          {...field('email')}
          error={errors.email?.message}
        />

        <div>
          <PasswordInput
            field={field('password')}
            error={errors.password?.message}
            hint={isLogin ? null : 'min. 10 characters'}
            placeholder={isLogin ? 'Your password' : 'Make it a good one'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          {isLogin && (
            <div className="mt-2 text-right">
              <Link to="/forgot-password" className="text-[13px] text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
                Forgot password?
              </Link>
            </div>
          )}
        </div>

        {!isLogin && <StrengthMeter password={pw} />}

        <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>
          {isLogin ? (invite ? 'Sign in & join' : 'Sign in') : invite ? `Join ${invite.workspaceName}` : 'Create workspace'}
          {!isSubmitting && <ArrowRight className="h-4 w-4" />}
        </Button>

        {!isLogin && (
          <p className="text-center text-xs leading-relaxed text-fg-3">
            By creating an account you agree to the <Link to="/terms" className="underline underline-offset-2 hover:text-fg">Terms</Link> and{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-fg">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'register' ? 'register' : 'login';
  const inviteToken = params.get('invite');
  const { user, isLoading, demoLogin, acceptInvite } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState('');
  // A reset link on a 2FA account hands over an MFA ticket instead of a session.
  const [mfaTicket, setMfaTicket] = useState(location.state?.mfaTicket || null);
  const [mfaNotice, setMfaNotice] = useState('');

  const goNext = () => navigate(location.state?.from || '/dashboard', { replace: true });

  // Already signed in → straight to the app (but let invite links accept first).
  useEffect(() => {
    if (!isLoading && user && !inviteToken) navigate('/dashboard', { replace: true });
  }, [isLoading, user, inviteToken, navigate]);

  useEffect(() => {
    api.get('/auth/config').then((r) => setDemoEnabled(Boolean(r.data.demoLogin))).catch(() => setDemoEnabled(false));
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    api
      .get(`/auth/invites/${inviteToken}`)
      .then((r) => {
        if (r.data.expired) setInviteError('This invitation has expired. Ask your teammate to send a new one.');
        else setInvite({ ...r.data, token: inviteToken });
      })
      .catch((err) => setInviteError(err.message));
  }, [inviteToken]);

  const tryDemo = async () => {
    setDemoLoading(true);
    setDemoError('');
    try {
      await demoLogin();
      goNext();
    } catch (err) {
      setDemoError(err.message);
    } finally {
      setDemoLoading(false);
    }
  };

  // Existing-account invite: sign in, then accept.
  const onAuthDone = async () => {
    if (invite && mode === 'login') {
      try {
        await acceptInvite(invite.token);
      } catch (err) {
        setInviteError(err.message);
        return;
      }
    }
    goNext();
  };

  const isLogin = mode === 'login';
  const toggle = () => {
    const next = new URLSearchParams(params);
    if (isLogin) next.set('mode', 'register');
    else next.delete('mode');
    setParams(next, { replace: true });
  };

  return (
    <AuthShell
      eyebrow={mfaTicket ? 'Two-step verification' : invite ? `Invitation · ${invite.role}` : isLogin ? 'Welcome back' : 'Free forever · no card'}
      title={
        invite ? (
          <>Join <span className="serif-i">{invite.workspaceName}</span></>
        ) : isLogin ? (
          <>Sign in to <span className="serif-i">PulseWatch</span></>
        ) : (
          <>Start <span className="serif-i">watching.</span></>
        )
      }
      subtitle={
        invite
          ? `${invite.inviterName} invited ${invite.email}. ${invite.hasAccount ? 'Sign in to accept.' : 'Create your account to join the team.'}`
          : isLogin
            ? 'Your monitors kept working while you were away.'
            : 'Five monitors, every alert channel and a public status page for your company — in about a minute.'
      }
    >
      {inviteError && <div className="mb-6"><Notice tone="error">{inviteError}</Notice></div>}

      {mfaNotice && <div className="mb-6"><Notice tone="error">{mfaNotice}</Notice></div>}
      {mfaTicket ? (
        <TwoFactorStep
          ticket={mfaTicket}
          onDone={onAuthDone}
          onCancel={(msg) => { setMfaTicket(null); setMfaNotice(msg || ''); }}
        />
      ) : (
        /* key remounts the form so the right schema & defaults apply */
        <AuthForm key={`${mode}-${invite?.token || ''}`} mode={mode} invite={invite} onDone={onAuthDone} onMfa={(t) => { setMfaNotice(''); setMfaTicket(t); }} />
      )}

      {demoEnabled && !invite && !mfaTicket && (
        <>
          <div className="my-7 flex items-center gap-4 text-[11px] uppercase tracking-[0.14em] text-fg-3">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="outline" size="lg" className="w-full" onClick={tryDemo} isLoading={demoLoading}>
            Explore the demo workspace
          </Button>
          {demoError && <p className="mt-2 text-center text-xs text-down">{demoError}</p>}
        </>
      )}

      <p className="mt-10 text-center text-sm text-fg-3">
        {isLogin ? 'New to PulseWatch?' : 'Already have an account?'}{' '}
        <button type="button" onClick={toggle} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
          {isLogin ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </AuthShell>
  );
}
