// Cookie policy: exactly what Safe Zone stores in the browser and which outside services are contacted, plus the
// visitor's current choice with buttons to change it. Public page (also reachable when logged out).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { CONSENT_EVENT, readConsent, saveConsent } from '../lib/consent';
import './landing.css';

const NECESSARY = [
  ['token, user', 'Local storage', 'Keeps you logged in and remembers who you are on this device.', 'Until you log out (the session itself ends after inactivity)'],
  ['logoutReason', 'Session storage', 'Tells you why you were logged out automatically (e.g. after inactivity).', 'Until the tab is closed'],
  ['oauth_status', 'Local storage', 'Tells the open Safe Zone tab that connecting Google Calendar in the pop-up has finished.', 'Until replaced'],
  ['theme, projectView', 'Local storage', 'Your own choices: light or dark mode, Gantt or list view.', 'Until you change or clear them'],
  ['cookieConsent', 'Local storage', 'Remembers your choice on this page, so the notice is not shown again.', 'Until you change it'],
];

export default function CookiePolicy() {
  const [consent, setConsent] = useState(readConsent);
  useEffect(() => {
    const update = () => setConsent(readConsent());
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/home" className="lp-logo" aria-label="Safe Zone home"><BrandLogo size={32} /></Link>
          <div className="lp-nav-actions">
            <Link to="/dashboard" className="lp-btn lp-btn-ghost">Back to Safe Zone</Link>
          </div>
        </div>
      </header>

      <main className="lp-container" style={{ maxWidth: 860, padding: '40px 16px 64px' }}>
        <h1 className="lp-h2" style={{ textAlign: 'left' }}>Cookie policy</h1>
        <p className="lp-muted">Last updated: November 2026 · Version 1</p>

        <section className="lp-card mb-4" aria-labelledby="choice-title" style={{ marginBottom: 24 }}>
          <h2 id="choice-title" className="lp-h3">Your choice</h2>
          <p className="mb-3">
            {consent === null
              ? 'You have not chosen yet. Until you do, only necessary storage is used and the Google font is not loaded.'
              : consent.external
                ? `You accepted all, on ${new Date(consent.decidedAt).toLocaleString()}. The Inter font is loaded from Google Fonts.`
                : `You chose only necessary storage, on ${new Date(consent.decidedAt).toLocaleString()}. Nothing is loaded from Google Fonts.`}
          </p>
          <div className="lp-cta-row">
            <button type="button" className={`lp-btn ${consent && !consent.external ? 'lp-btn-primary' : 'lp-btn-ghost'}`} aria-pressed={!!consent && !consent.external} onClick={() => saveConsent(false)}>Only necessary</button>
            <button type="button" className={`lp-btn ${consent?.external ? 'lp-btn-primary' : 'lp-btn-ghost'}`} aria-pressed={!!consent?.external} onClick={() => saveConsent(true)}>Accept all</button>
          </div>
        </section>

        <section aria-labelledby="summary-title" style={{ marginBottom: 24 }}>
          <h2 id="summary-title" className="lp-h3">In short</h2>
          <ul>
            <li>Safe Zone sets <strong>no cookies</strong> and uses <strong>no tracking, analytics or advertising</strong>.</li>
            <li>It stores a few items in your browser's <strong>local storage</strong> that the site needs to work. EU rules treat this like cookies, but strictly necessary storage does not need consent.</li>
            <li>The only optional item is the <strong>Inter font from Google Fonts</strong>. Loading it sends your IP address to Google, so it is only loaded if you choose "Accept all".</li>
          </ul>
        </section>

        <section aria-labelledby="necessary-title" style={{ marginBottom: 24 }}>
          <h2 id="necessary-title" className="lp-h3">Necessary storage (always on)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="sz-policy-table">
              <thead><tr><th scope="col">Name</th><th scope="col">Where</th><th scope="col">Why</th><th scope="col">How long</th></tr></thead>
              <tbody>
                {NECESSARY.map(([name, where, why, how]) => (
                  <tr key={name}><td><code>{name}</code></td><td>{where}</td><td>{why}</td><td>{how}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="optional-title" style={{ marginBottom: 24 }}>
          <h2 id="optional-title" className="lp-h3">Optional: external content (only with "Accept all")</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="sz-policy-table">
              <thead><tr><th scope="col">Service</th><th scope="col">Provider</th><th scope="col">Why</th><th scope="col">What it receives</th></tr></thead>
              <tbody>
                <tr><td>Google Fonts</td><td>Google Ireland Ltd.</td><td>Shows the Inter font. Without it, your computer's own font is used; everything works the same.</td><td>Your IP address and browser details when the font is downloaded</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="third-title" style={{ marginBottom: 24 }}>
          <h2 id="third-title" className="lp-h3">Services you start yourself</h2>
          <p>These are only contacted when you use them, and they may set their own cookies on their own websites:</p>
          <ul>
            <li><strong>Google Calendar / Google Meet</strong>: when you click "Connect Google Calendar" or join a Google Meet call.</li>
            <li><strong>Jitsi Meet</strong>: when you click "Join call" for a Jitsi meeting.</li>
            <li><strong>Google Gemini (AI assistant)</strong>: when you generate a draft, the meeting details and your instructions are sent to Google to write the text.</li>
          </ul>
        </section>

        <section aria-labelledby="control-title">
          <h2 id="control-title" className="lp-h3">How to remove stored data</h2>
          <p>Logging out removes your login from this browser. You can delete everything Safe Zone stored in your browser's settings ("Clear site data" for this website). To delete your account and all your data on the server, use <em>Settings → Delete account</em>.</p>
        </section>
      </main>
    </div>
  );
}
