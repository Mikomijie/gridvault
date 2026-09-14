import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { OfflineProvider } from './context/OfflineContext.jsx';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

// Route guards are UX only (AT-602): every route's data comes from an
// endpoint that re-evaluates policy server-side.
function RequireAuth({ children }) {
  const { user, loading, restoreSession } = useAuth();
  const [restoring, setRestoring] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    if (user === null && !loading) {
      restoreSession().finally(() => {
        if (!cancelled) setRestoring(false);
      });
    } else {
      setRestoring(false);
    }
    return () => {
      cancelled = true;
    };
  }, [user, loading, restoreSession]);
  if (loading || restoring) return null;
  if (user === null) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineProvider>
      <Router>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
      </OfflineProvider>
    </AuthProvider>
  );
}
