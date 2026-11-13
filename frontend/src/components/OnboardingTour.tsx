// First-login tour: a short step-by-step introduction to the main parts of Safe Zone.
// Shown automatically once per account (the server remembers it in User.onboardedAt) and can be reopened from Settings.
// While the tour is open the sidebar stays bright above the dimmed page and the item being explained is highlighted.
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button, Modal } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { LogoMark } from './BrandLogo';
import './onboarding.css';

/** Other pages open the tour with: window.dispatchEvent(new Event(START_TOUR_EVENT)) */
export const START_TOUR_EVENT = 'safezone:start-tour';

interface Step { target?: string; icon: string; title: string; text: string }

const STEPS: Step[] = [
  { icon: 'bi-hand-thumbs-up', title: 'Welcome to Safe Zone', text: 'A one-minute tour of the main parts of the app. You can skip it now and reopen it any time in Settings.' },
  { target: 'dashboard', icon: 'bi-grid-1x2', title: 'Dashboard', text: 'Your overview: polls waiting for your vote, your next meetings with a Join button, and the to-dos assigned to you.' },
  { target: 'projects', icon: 'bi-folder', title: 'Projects', text: 'Create a project and add your team with a role: manager, employee or observer. Plan phases and activities on the Gantt chart.' },
  { target: 'meetings', icon: 'bi-calendar-event', title: 'Meetings', text: 'Propose a few times (Safe Zone suggests free slots across time zones). Colleagues vote and the meeting is confirmed when a majority says yes. Each meeting gets a video link and a to-do list.' },
  { target: 'reports', icon: 'bi-bar-chart-line', title: 'Reports', text: 'See meetings, hours and activity progress by project, period, meeting type, phase or person, and export them as PDF or Excel.' },
  { target: 'settings', icon: 'bi-person-gear', title: 'Settings', text: 'Set your time zone and working hours, turn on two-factor login, and download or delete your data. You can restart this tour there too.' },
];

export default function OnboardingTour() {
  const { user } = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Show automatically on the first login (administrators have their own panel and are not shown the user tour)
  useEffect(() => {
    if (!user || user.role === 'ADMIN') return;
    let cancelled = false;
    axios.get('/api/auth/me')
      .then(res => { if (!cancelled && !res.data.onboardedAt) { setStep(0); setOpen(true); } })
      .catch(() => { /* not important enough to show an error */ });
    return () => { cancelled = true; };
  }, [user]);

  // Reopened from Settings
  useEffect(() => {
    const start = () => { setStep(0); setOpen(true); };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  // Highlight the sidebar item of the current step
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('sz-touring');
    const key = STEPS[step].target;
    const target = key ? document.querySelector(`.saas-sidebar [data-tour="${key}"]`) : null;
    target?.classList.add('sz-tour-target');
    return () => {
      target?.classList.remove('sz-tour-target');
      document.body.classList.remove('sz-touring');
    };
  }, [open, step]);

  const close = useCallback(() => {
    setOpen(false);
    axios.post('/api/users/me/onboarding').catch(() => {});
  }, []);

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal show={open} onHide={close} centered dialogClassName="sz-tour-dialog" aria-labelledby="sz-tour-title">
      <Modal.Body className="p-4">
        <div className="d-flex align-items-center gap-3 mb-3">
          {step === 0
            ? <LogoMark size={40} />
            : <span className="sz-tour-icon"><i className={`bi ${current.icon}`} aria-hidden="true"></i></span>}
          <div>
            <div className="small fw-semibold" style={{ color: 'var(--text-secondary)' }}>Step {step + 1} of {STEPS.length}</div>
            <h2 id="sz-tour-title" className="h5 fw-bold mb-0">{current.title}</h2>
          </div>
        </div>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }} aria-live="polite">{current.text}</p>

        {/* progress dots */}
        <div className="d-flex gap-2 mb-4" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={`sz-tour-dot${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`} />)}
        </div>

        <div className="d-flex justify-content-between align-items-center gap-2">
          {last ? <span /> : (
            <Button variant="link" className="px-0 text-decoration-none" style={{ color: 'var(--text-secondary)' }} onClick={close}>Skip tour</Button>
          )}
          <div className="d-flex gap-2">
            {step > 0 && <Button variant="outline-secondary" onClick={() => setStep(s => s - 1)}>Back</Button>}
            {last
              ? <Button onClick={close}>Get started</Button>
              : <Button onClick={() => setStep(s => s + 1)}>{step === 0 ? 'Show me' : 'Next'}</Button>}
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
