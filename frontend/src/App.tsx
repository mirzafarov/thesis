import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Projects from './pages/Projects';
import ProjectDetails from './pages/ProjectDetails';
import Meetings from './pages/Meetings';
import Reports from './pages/Reports';
import Profile from './pages/Profile';
import AdminLogs from './pages/AdminLogs';
import UserManagement from './pages/UserManagement';
import OAuthSuccess from './pages/OAuthSuccess';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/AuthPages';
import SetupTwoFactor from './pages/SetupTwoFactor';
import { AuthContext, AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useEffect, useContext, lazy, Suspense } from 'react';
import type { ComponentType } from 'react';

// The cinematic 3D welcome (Three.js) is loaded only when that page is opened. The file name is passed as a
// variable so the app's type-check stays separate from the 3D code (see tsconfig.welcome.json); Vite still bundles it.
const WELCOME_MODULE = 'WelcomePage';
const WelcomePage = lazy(() => import(`./welcome/${WELCOME_MODULE}.tsx`) as Promise<{ default: ComponentType }>);

// Admin Route Wrapper
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(AuthContext);
  if (user?.role !== 'ADMIN') return <Navigate to="/dashboard" />;
  return <>{children}</>;
};

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/welcome" element={<Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#05060f' }} />}><WelcomePage /></Suspense>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/oauth-success" element={<OAuthSuccess />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/setup-2fa" element={<ProtectedRoute><SetupTwoFactor /></ProtectedRoute>} />

          {/* Protected Routes wrapped in Layout */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetails />} />
            <Route path="/meetings" element={<Meetings />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin/logs" element={<AdminRoute><AdminLogs /></AdminRoute>} />
            <Route path="/admin/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
