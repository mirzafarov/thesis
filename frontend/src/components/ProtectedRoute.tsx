import { Navigate, useLocation } from 'react-router-dom';
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { AuthContext } from '../context/AuthContext';

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, user } = useContext(AuthContext);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Managers and administrators must set up two-factor login before anything else.
  if (user?.mfaSetupRequired && location.pathname !== '/setup-2fa') {
    return <Navigate to="/setup-2fa" replace />;
  }

  return <>{children}</>;
};
