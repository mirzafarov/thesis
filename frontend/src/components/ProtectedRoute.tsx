import { Navigate, useLocation } from 'react-router-dom';
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { AuthContext, hasLogoutReason } from '../context/AuthContext';

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, user } = useContext(AuthContext);
  const location = useLocation();

  if (!isAuthenticated) {
    // After an automatic logout (inactivity, expired session) go straight to the form, which explains why;
    // otherwise start with the landing page, which explains Safe Zone.
    return <Navigate to={hasLogoutReason() ? '/login' : '/home'} replace />;
  }

  // Managers and administrators must set up two-factor login before anything else.
  if (user?.mfaSetupRequired && location.pathname !== '/setup-2fa') {
    return <Navigate to="/setup-2fa" replace />;
  }

  return <>{children}</>;
};
