// The Safe Zone welcome screen as it appears on the laptop display (real, clickable DOM elements).
import { motion } from 'framer-motion';
import { SCREEN_PX } from './office';

export type AuthTarget = 'login' | 'register';

interface Props {
  onChoose: (target: AuthTarget) => void;
  leaving: AuthTarget | null;
  reducedMotion: boolean;
}

export const LogoMark = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="sz-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#a78bfa" />
      </linearGradient>
    </defs>
    <path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" fill="url(#sz-logo)" />
    <path d="M24 13c-4.4 0-8 3.2-8 7.6 0 6.4 8 12.4 8 12.4s8-6 8-12.4C32 16.2 28.4 13 24 13Zm0 10.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="#0b1026" opacity=".85" />
  </svg>
);

export default function ScreenUI({ onChoose, leaving, reducedMotion }: Props) {
  const appear = reducedMotion
    ? { initial: { opacity: 1 }, animate: { opacity: leaving ? 0 : 1 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: leaving ? 0 : 1, y: 0, scale: leaving ? 1.04 : 1 } };

  return (
    <div className="sz-screen" style={{ width: SCREEN_PX.width, height: SCREEN_PX.height }}>
      {/* macOS-like top bar makes it read as a real desktop app */}
      <div className="sz-screen-bar" aria-hidden="true">
        <span /><span /><span />
        <div className="sz-screen-url">safezone.app</div>
      </div>
      <motion.main
        className="sz-screen-body"
        {...appear}
        transition={{ duration: leaving ? 0.45 : 0.9, delay: leaving ? 0 : reducedMotion ? 0 : 1.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sz-screen-glow" aria-hidden="true" />
        <div className="sz-brand">
          <LogoMark size={46} />
          <span>Safe <b>Zone</b></span>
        </div>
        <h1 className="sz-title">Welcome to Safe Zone</h1>
        <p className="sz-tagline">Your workspace. Your security. Your control.</p>
        <div className="sz-actions">
          <button type="button" className="sz-btn sz-btn-primary" onClick={() => onChoose('login')} disabled={!!leaving}>
            Sign In
          </button>
          <button type="button" className="sz-btn sz-btn-ghost" onClick={() => onChoose('register')} disabled={!!leaving}>
            Create Account
          </button>
        </div>
        <p className="sz-footnote">Meeting scheduling &amp; project management for distributed teams</p>
      </motion.main>
    </div>
  );
}
