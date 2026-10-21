import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

const EMPTY = { user: null, workspace: null, workspaces: [], requireEmailVerification: true, twoFactorRequired: false };

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(EMPTY);
  const [isLoading, setIsLoading] = useState(true);

  // Every auth endpoint returns the same session shape — apply it in one place.
  const apply = useCallback((data) => {
    setSession({
      user: data.user,
      workspace: data.workspace,
      workspaces: data.workspaces || [],
      requireEmailVerification: data.requireEmailVerification ?? true,
      twoFactorRequired: Boolean(data.twoFactorRequired),
    });
    return data;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      return apply(res.data);
    } catch {
      setSession(EMPTY);
      return null;
    }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/me')
      .then((res) => { if (!cancelled) apply(res.data); })
      .catch(() => { if (!cancelled) setSession(EMPTY); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [apply]);

  // Keep plan, role and limits current for every open tab and teammate: an upgrade, a role
  // change or a lapsed plan shows up within a minute, or instantly when the tab regains focus.
  const signedIn = Boolean(session.user);
  useEffect(() => {
    if (!signedIn) return undefined;
    let last = Date.now();
    const sync = () => {
      if (document.hidden || Date.now() - last < 15000) return;
      last = Date.now();
      api.get('/auth/me').then((res) => apply(res.data)).catch((err) => {
        if (err.status === 401) setSession(EMPTY);
      });
    };
    const id = setInterval(sync, 60000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [signedIn, apply]);

  const call = useCallback(async (method, url, body) => apply((await api[method](url, body)).data), [apply]);

  // With 2FA on, the password step returns { mfaRequired, mfaTicket } and no session yet.
  const login = useCallback(async (credentials) => {
    const res = await api.post('/auth/login', credentials);
    return res.data.mfaRequired ? res.data : apply(res.data);
  }, [apply]);
  const verifyTwoFactor = useCallback((mfaTicket, code) => call('post', '/auth/login/2fa', { mfaTicket, code }), [call]);
  const register = useCallback((data) => call('post', '/auth/register', data), [call]);
  const demoLogin = useCallback(() => call('post', '/auth/demo'), [call]);
  const resetPassword = useCallback(async (token, password) => {
    const res = await api.post('/auth/reset-password', { token, password });
    return res.data.mfaRequired ? res.data : apply(res.data);
  }, [apply]);
  const acceptInvite = useCallback((token) => call('post', `/auth/invites/${token}/accept`), [call]);
  const switchWorkspace = useCallback((workspaceId) => call('post', '/workspaces/switch', { workspaceId }), [call]);
  const createWorkspace = useCallback((name) => call('post', '/workspaces', { name }), [call]);
  const updateProfile = useCallback((data) => call('patch', '/auth/profile', data), [call]);
  const changePassword = useCallback((data) => call('post', '/auth/password', data), [call]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(EMPTY);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await api.post('/auth/logout-all');
    } finally {
      setSession(EMPTY);
    }
  }, []);

  const deleteAccount = useCallback(async (password) => {
    await api.delete('/auth/account', { data: { password } });
    setSession(EMPTY);
  }, []);

  /** Patch the active workspace locally (e.g. after a rename or a payment). */
  const setWorkspace = useCallback((workspace) => {
    setSession((s) => ({
      ...s,
      workspace: { ...s.workspace, ...workspace },
      workspaces: s.workspaces.map((w) => (w._id === workspace._id ? { ...w, ...workspace } : w)),
    }));
  }, []);

  const role = session.workspace?.role || 'member';
  const value = useMemo(
    () => ({
      ...session,
      isLoading,
      role,
      isOwner: role === 'owner',
      isAdmin: role === 'owner' || role === 'admin',
      needsVerification: Boolean(session.user && session.requireEmailVerification && !session.user.emailVerified),
      apply,
      refresh,
      login,
      verifyTwoFactor,
      register,
      demoLogin,
      logout,
      logoutAll,
      resetPassword,
      acceptInvite,
      switchWorkspace,
      createWorkspace,
      updateProfile,
      changePassword,
      deleteAccount,
      setWorkspace,
    }),
    [session, isLoading, role, apply, refresh, login, verifyTwoFactor, register, demoLogin, logout, logoutAll, resetPassword, acceptInvite, switchWorkspace, createWorkspace, updateProfile, changePassword, deleteAccount, setWorkspace]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
