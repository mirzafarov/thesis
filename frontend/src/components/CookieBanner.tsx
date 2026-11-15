// Cookie notice shown until the visitor makes a choice. Not a blocking pop-up: the page stays usable, and the page
// gets extra bottom space so the banner never covers the content (or the keyboard focus) underneath.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CONSENT_EVENT, readConsent, saveConsent } from '../lib/consent';
import './cookieBanner.css';

export default function CookieBanner() {
  const [visible, setVisible] = useState(() => !readConsent());
  const ref = useRef<HTMLElement>(null);

  // The choice can also be changed on the cookie policy page
  useEffect(() => {
    const update = () => setVisible(!readConsent());
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);

  // Reserve space at the bottom of the page while the banner is shown
  useEffect(() => {
    if (!visible || !ref.current) return;
    const el = ref.current;
    const observer = new ResizeObserver(() => { document.body.style.paddingBottom = `${el.offsetHeight}px`; });
    observer.observe(el);
    return () => { observer.disconnect(); document.body.style.paddingBottom = ''; };
  }, [visible]);

  if (!visible) return null;

  return (
    <section ref={ref} className="sz-cookie" role="region" aria-label="Cookie notice">
      <div className="sz-cookie-inner">
        <p className="sz-cookie-text">
          <i className="bi bi-cookie me-2" aria-hidden="true"></i>
          Safe Zone uses <strong>no tracking or advertising</strong>. We only store what the site needs to work (your login and settings) in your browser.
          With your permission we also load the <strong>Inter font from Google Fonts</strong>, which sends your IP address to Google.{' '}
          <Link to="/cookies">Cookie policy</Link>
        </p>
        <div className="sz-cookie-actions">
          <button type="button" className="sz-cookie-btn sz-cookie-btn-ghost" onClick={() => saveConsent(false)}>Only necessary</button>
          <button type="button" className="sz-cookie-btn sz-cookie-btn-primary" onClick={() => saveConsent(true)}>Accept all</button>
        </div>
      </div>
    </section>
  );
}
