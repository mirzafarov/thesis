// Shared frame for the login, registration and password pages: a soft blue/purple background and the logo,
// which links back to the landing page. The forms inside are unchanged.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../BrandLogo';
import './auth.css';

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="sz-auth" data-bs-theme="dark">
      <div className="sz-liquid-bg" aria-hidden="true"><span /><span /><span /></div>
      {/* Entrance animation in CSS (keeps the animation library out of the main bundle) */}
      <div className="sz-auth-inner sz-enter">
        <Link to="/home" className="sz-auth-brand" aria-label="Safe Zone — back to the home page">
          <LogoMark size={34} />
          <span>Safe <b>Zone</b></span>
        </Link>
        {children}
      </div>
    </div>
  );
}
