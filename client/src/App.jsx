import React, { Component, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import { PageLoader } from './components/PageLoader';

// Split heavier, non-landing routes out of the first load.
const AuthPage = lazy(() => import('./pages/Auth'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const LegalPage = lazy(() => import('./pages/Legal'));
const GuidePage = lazy(() => import('./pages/Guide'));
const ForgotPasswordPage = lazy(() => import('./pages/AccountFlows').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/AccountFlows').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/AccountFlows').then((m) => ({ default: m.VerifyEmailPage })));
const AcceptInvitePage = lazy(() => import('./pages/AccountFlows').then((m) => ({ default: m.AcceptInvitePage })));

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-fg">
          <div className="panel w-full max-w-md p-8">
            <div className="eyebrow mb-3 text-down">Application error</div>
            <h1 className="text-2xl font-medium tracking-tight">Something went wrong.</h1>
            <p className="mt-3 break-words font-mono text-xs text-fg-3">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-fg px-4 text-sm font-medium text-bg hover:bg-white"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ScrollReset() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AppRoutes() {
  const { user, isLoading } = useAuth();

  return (
    <Suspense fallback={<PageLoader />}>
      <ScrollReset />
      <Routes>
        <Route path="/" element={!isLoading && user ? <Navigate to="/dashboard" replace /> : <Landing />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/status/:slug" element={<StatusPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/terms" element={<LegalPage doc="terms" />} />
        <Route path="/privacy" element={<LegalPage doc="privacy" />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
