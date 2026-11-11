import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** Logged in, but must set up two-factor login before using the app (managers and admins). */
  mfaSetupRequired?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: (reason?: string) => void;
  updateUser: (changes: Partial<User>) => void;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  isAuthenticated: false,
});

// Must match SESSION_IDLE_MINUTES on the server (the server enforces it too).
const IDLE_MINUTES = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES || 30);
const LOGOUT_REASON_KEY = 'logoutReason';

/** Message to show on the login page after an automatic logout (read once). */
export function takeLogoutReason(): string {
  try {
    const reason = sessionStorage.getItem(LOGOUT_REASON_KEY) || '';
    sessionStorage.removeItem(LOGOUT_REASON_KEY);
    return reason;
  } catch {
    return '';
  }
}

function readStoredSession(): { token: string | null; user: User | null } {
  try {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) return { token, user: JSON.parse(user) };
  } catch {
    // Corrupt or unavailable storage: treat as logged out.
  }
  return { token: null, user: null };
}

// Read the saved session before the first render, so a page refresh doesn't bounce to /login.
const initialSession = readStoredSession();
if (initialSession.token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${initialSession.token}`;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(initialSession.user);
  const [token, setToken] = useState<string | null>(initialSession.token);
  const idleTimer = useRef<number | undefined>(undefined);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
  };

  const clearSession = useCallback((reason?: string) => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    if (reason) {
      try { sessionStorage.setItem(LOGOUT_REASON_KEY, reason); } catch { /* storage unavailable */ }
    }
  }, []);

  // Logging out also ends the session on the server, so the token cannot be reused.
  const logout = useCallback((reason?: string) => {
    if (axios.defaults.headers.common['Authorization']) {
      axios.post('/api/auth/logout').catch(() => { /* already ended */ });
    }
    clearSession(reason);
  }, [clearSession]);

  const updateUser = useCallback((changes: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  // Server answers: 401 = session ended (expired, idle, revoked) -> log out with the reason;
  // 403 MFA_SETUP_REQUIRED -> the user must set up two-factor login first.
  useEffect(() => {
    const id = axios.interceptors.response.use(
      response => response,
      error => {
        const status = error.response?.status;
        const data = error.response?.data;
        const url: string = error.config?.url || '';
        if (status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/logout')) {
          clearSession(data?.code === 'SESSION_IDLE' || data?.code === 'SESSION_ENDED' ? data.error : 'Your session has ended. Please log in again.');
        } else if (status === 403 && data?.code === 'MFA_SETUP_REQUIRED') {
          updateUser({ mfaSetupRequired: true });
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, [clearSession, updateUser]);

  // Log out after IDLE_MINUTES without mouse, keyboard, touch or scroll activity.
  useEffect(() => {
    if (!token) return;
    const reset = () => {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(
        () => logout(`You were logged out after ${IDLE_MINUTES} minutes of inactivity. Please log in again.`),
        IDLE_MINUTES * 60 * 1000
      );
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};
