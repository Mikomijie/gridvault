import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { OfflineProvider } from './context/OfflineContext.jsx';
import { LockProvider } from './context/LockContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PatientDossierPage from './pages/PatientDossierPage';
import SecurityPage from './pages/SecurityPage';
import HandoverPage from './pages/HandoverPage.jsx';
import TourPage from './pages/TourPage.jsx';

// Route guards are UX only (AT-602): every route's data comes from an
// endpoint that re-evaluates policy server-side.
function RequireAuth({ children }) {
  const { user, loading, restoreSession } = useAuth();
  // Redirect only after the restore attempt finishes: otherwise the first
  // render with user null navigates to /login while the refresh is still
  // in flight, unmounting the guard before the session can land.
  const [checked, setChecked] = React.useState(false);
  React.useEffect(() => {
    if (loading) return undefined;
    if (user !== null) {
      setChecked(true);
      return undefined;
    }
    let cancelled = false;
    restoreSession().finally(() => {
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, restoreSession]);
  if (loading || !checked) return null;
  if (user === null) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
    {import.meta.env.VITE_PUBLIC_DEMO === 'true' && (
      <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
        Public demo — fictional patients and shared accounts. Do not enter real personal or medical information.
      </div>
    )}
    <AuthProvider>
      <OfflineProvider>
      <Router>
        <LockProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/patient/:id"
            element={
              <RequireAuth>
                <PatientDossierPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/security"
            element={
              <RequireAuth>
                <SecurityPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/handover"
            element={
              <RequireAuth>
                <HandoverPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route path="/tour" element={<TourPage />} />
        </Routes>
        </LockProvider>
      </Router>
      </OfflineProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
