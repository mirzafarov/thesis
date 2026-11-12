// Entry experience: cinematic 3D office (or a 2D fallback) that leads into the real login and registration pages.
import { Component, lazy, Suspense, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AuthContext } from '../context/AuthContext';
import { LogoMark } from './ScreenUI';
import type { AuthTarget } from './ScreenUI';
import '../components/auth/auth.css';
import './welcome.css';

// Three.js is only downloaded for this page.
const Scene = lazy(() => import('./Scene'));

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Respects the system "reduce motion" setting. For presentations, /welcome?motion=on forces the full
 * cinematic version (Windows sets "reduce motion" when "Animation effects" are switched off).
 */
const prefersReducedMotion = () => {
  try {
    const forced = new URLSearchParams(window.location.search).get('motion');
    if (forced === 'on') return false;
    if (forced === 'off') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** If the 3D scene fails (old GPU, lost context …), show the 2D version instead of a blank page. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn('3D welcome scene unavailable, showing 2D version:', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** 2D version for browsers without WebGL: same content, CSS liquid shapes, same transitions. */
function FlatWelcome({ onChoose, leaving }: { onChoose: (t: AuthTarget) => void; leaving: AuthTarget | null }) {
  return (
    <div className="sz-flat">
      <div className="sz-liquid-bg" aria-hidden="true"><span /><span /><span /></div>
      <motion.div className="sz-flat-laptop" initial={{ opacity: 0, y: 20 }} animate={{ opacity: leaving ? 0 : 1, y: 0, scale: leaving ? 1.06 : 1 }} transition={{ duration: 0.6 }}>
        <div className="sz-flat-brand"><LogoMark size={52} /><span>Safe <b>Zone</b></span></div>
        <h1 className="sz-title">Welcome to Safe Zone</h1>
        <p className="sz-tagline">Your workspace. Your security. Your control.</p>
        <div className="sz-actions">
          <button type="button" className="sz-btn sz-btn-primary" onClick={() => onChoose('login')} disabled={!!leaving}>Sign In</button>
          <button type="button" className="sz-btn sz-btn-ghost" onClick={() => onChoose('register')} disabled={!!leaving}>Create Account</button>
        </div>
      </motion.div>
    </div>
  );
}

export default function WelcomePage() {
  const { isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();
  const [target, setTarget] = useState<AuthTarget | null>(null);
  const [webgl] = useState(hasWebGL);
  const [reducedMotion] = useState(prefersReducedMotion);

  const go = useCallback((t: AuthTarget) => {
    navigate(t === 'login' ? '/login' : '/register', { state: { fromIntro: true } });
  }, [navigate]);

  // 2D version: short fade, then the page
  const chooseFlat = (t: AuthTarget) => {
    setTarget(t);
    window.setTimeout(() => go(t), reducedMotion ? 150 : 550);
  };

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const flat = <FlatWelcome onChoose={chooseFlat} leaving={target} />;

  return (
    <div className="sz-welcome">
      {webgl ? (
        <SceneBoundary fallback={flat}>
          <Suspense fallback={<div className="sz-loading" role="status"><LogoMark size={56} /><span>Preparing your workspace…</span></div>}>
            <Scene target={target} onChoose={setTarget} onTransitionDone={go} reducedMotion={reducedMotion} />
          </Suspense>
        </SceneBoundary>
      ) : flat}

      {/* Always-available shortcuts (keyboard users, returning users, slow devices) */}
      <nav className="sz-welcome-skip" aria-label="Skip intro">
        <button type="button" onClick={() => go('login')}>Skip to sign in</button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => go('register')}>Create account</button>
      </nav>
    </div>
  );
}
