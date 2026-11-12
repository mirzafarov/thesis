// Shared frame for the login, registration and password pages: the same liquid blue/purple background the
// welcome transition ends on, so arriving from the 3D intro feels seamless. The forms inside are unchanged.
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './auth.css';

const Logo = () => (
  <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="sz-auth-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#a78bfa" />
      </linearGradient>
    </defs>
    <path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" fill="url(#sz-auth-logo)" />
    <path d="M24 13c-4.4 0-8 3.2-8 7.6 0 6.4 8 12.4 8 12.4s8-6 8-12.4C32 16.2 28.4 13 24 13Zm0 10.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="#0b1026" opacity=".85" />
  </svg>
);

export default function AuthShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Coming from the 3D intro, the background is already on screen: only the form fades in.
  const fromIntro = !!(location.state as { fromIntro?: boolean } | null)?.fromIntro;

  return (
    <div className="sz-auth" data-bs-theme="dark">
      <div className="sz-liquid-bg" aria-hidden="true"><span /><span /><span /></div>
      {/* Entrance animation in CSS (keeps the animation library out of the main bundle) */}
      <div className={`sz-auth-inner ${fromIntro ? 'sz-enter-intro' : 'sz-enter'}`}>
        <Link to="/welcome" className="sz-auth-brand" aria-label="Safe Zone — back to the welcome screen">
          <Logo />
          <span>Safe <b>Zone</b></span>
        </Link>
        {children}
      </div>
    </div>
  );
}
