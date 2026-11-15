// Cookie / storage consent (GDPR + ePrivacy).
// Safe Zone sets no cookies and does no tracking. Necessary browser storage (login session, your own settings) needs no
// consent. The only optional item is "external content": the Inter font from Google Fonts, which sends the visitor's
// IP address to Google. It is loaded only after "Accept all"; otherwise the computer's own font is used.

const CONSENT_KEY = 'cookieConsent';
/** Raise when the cookie policy changes in a way that needs a new choice. */
export const CONSENT_VERSION = 1;
export const CONSENT_EVENT = 'safezone:consent-changed';

export interface Consent { version: number; external: boolean; decidedAt: string }

export function readConsent(): Consent | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null') as Consent | null;
    return c && c.version === CONSENT_VERSION ? c : null;
  } catch {
    return null;
  }
}

export function saveConsent(external: boolean) {
  const consent: Consent = { version: CONSENT_VERSION, external, decidedAt: new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* storage blocked: choice applies to this visit only */ }
  applyConsent(consent);
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';

/** Load or remove the Google font according to the choice (no choice yet = not loaded). */
export function applyConsent(consent = readConsent()) {
  const existing = document.getElementById('google-font-inter');
  if (consent?.external && !existing) {
    const link = document.createElement('link');
    link.id = 'google-font-inter';
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    document.head.appendChild(link);
  } else if (!consent?.external && existing) {
    existing.remove();
  }
}
