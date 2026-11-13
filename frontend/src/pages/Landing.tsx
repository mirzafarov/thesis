// Public landing page: what Safe Zone does, and the way in (sign up / log in).
// Uses the app's own colour tokens (index.css), so light and dark mode follow the app's theme switch.
import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import BrandLogo from '../components/BrandLogo';
import './landing.css';

const FEATURES = [
  { icon: 'bi-globe2', title: 'Time zones handled for you', text: 'Everyone sees times in their own zone. Times that fall at night for someone are marked before you send the poll.' },
  { icon: 'bi-ui-radios', title: 'Polls that confirm themselves', text: 'Propose a few times, colleagues vote, and the meeting is confirmed as soon as a majority says yes.' },
  { icon: 'bi-calendar-check', title: 'Google Calendar and free slots', text: 'Connect your calendar and Safe Zone suggests free times that fit everyone’s working hours.' },
  { icon: 'bi-camera-video', title: 'Video call links', text: 'Each online meeting gets a Jitsi room or a Google Meet link, with a Join button and the link in every reminder.' },
  { icon: 'bi-bar-chart-steps', title: 'Gantt chart for project plans', text: 'Phases, activities and critical tasks on a timeline. Late critical work is flagged and the right people are emailed.' },
  { icon: 'bi-file-earmark-bar-graph', title: 'Reports and an AI assistant', text: 'Filter meetings and export them as PDF or Excel. The AI assistant drafts agendas, invitations and minutes.' },
];

// The problems Safe Zone was built to solve (thesis motivation), each paired with the answer.
const PROBLEMS = [
  { icon: 'bi-envelope-exclamation', problem: 'Long email threads', text: 'Finding one time for five people can take a dozen emails.', answer: 'One poll: everyone votes on the proposed times.' },
  { icon: 'bi-clock-history', problem: 'Time zone mistakes', text: 'A meeting at 16:00 in Vilnius is 03:00 for someone abroad.', answer: 'Every time is shown in each person’s own zone.' },
  { icon: 'bi-diagram-3', problem: 'Meetings apart from the plan', text: 'Meetings, deadlines and project tasks live in different tools.', answer: 'Meetings are linked to project activities on a Gantt chart.' },
];

const STEPS = [
  { title: 'Create a project', text: 'Add your team and give each person a role: manager, employee or observer.' },
  { title: 'Propose times', text: 'Pick suggested free slots or add your own. Everyone gets an email to vote.' },
  { title: 'Meet', text: 'The time is confirmed, added to calendars, and reminders with the video link go out.' },
];

const SECURITY = ['Two-factor login', 'Account lockout after wrong passwords', 'Audit log of every important action', 'GDPR: export or delete your data'];

/** A small, static preview of a poll, so visitors see the product instead of a stock picture. */
const PollPreview = () => (
  <figure className="lp-preview" aria-label="Example: a meeting poll across time zones">
    <div className="lp-preview-head">
      <div>
        <div className="lp-preview-title">Sprint review</div>
        <div className="lp-muted lp-small">Website redesign · 45 min · Jitsi Meet</div>
      </div>
      <span className="lp-pill lp-pill-ok"><i className="bi bi-check-circle-fill" aria-hidden="true"></i> Confirmed</span>
    </div>
    <ul className="lp-slots">
      {[
        { local: 'Mon 10:00', others: '03:00 New York · 08:00 London', night: true, yes: 1, best: false },
        { local: 'Tue 16:00', others: '09:00 New York · 14:00 London', night: false, yes: 4, best: true },
        { local: 'Wed 18:00', others: '11:00 New York · 16:00 London', night: false, yes: 2, best: false },
      ].map(s => (
        <li key={s.local} className={`lp-slot${s.best ? ' lp-slot-best' : ''}`}>
          <div>
            <div className="lp-slot-time">{s.local} <span className="lp-muted lp-small">Vilnius</span></div>
            <div className="lp-small lp-muted">
              {s.night && <i className="bi bi-moon-stars lp-night" aria-label="night time for someone"></i>} {s.others}
            </div>
          </div>
          <div className="lp-votes" aria-label={`${s.yes} of 4 voted yes`}>
            {[0, 1, 2, 3].map(i => <span key={i} className={i < s.yes ? 'lp-dot lp-dot-yes' : 'lp-dot'} />)}
          </div>
        </li>
      ))}
    </ul>
    <figcaption className="lp-small lp-muted">4 of 4 voted · confirmed automatically by majority</figcaption>
  </figure>
);

const Landing = () => {
  const { user } = useContext(AuthContext);

  // After the first few pixels of scrolling, the top bar turns into a floating glass capsule (see .lp-nav.is-scrolled).
  // React only re-renders when the value flips, not on every scroll event.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      <a href="#lp-main" className="lp-skip">Skip to content</a>

      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="lp-container lp-nav-inner">
          <Link to="/home" className="lp-logo" aria-label="Safe Zone home">
            <BrandLogo size={32} />
          </Link>
          <nav aria-label="Page sections" className="lp-nav-links">
            <a href="#why">Why Safe Zone</a>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
          </nav>
          <div className="lp-nav-actions">
            {user ? (
              <Link to="/dashboard" className="lp-btn lp-btn-primary">Open the app</Link>
            ) : (
              <>
                <Link to="/login" className="lp-btn lp-btn-ghost">Log in</Link>
                <Link to="/register" className="lp-btn lp-btn-primary">Sign up</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div>
              <p className="lp-eyebrow">Meeting scheduling for project teams</p>
              <h1 className="lp-h1">Find a meeting time that works for everyone.</h1>
              <p className="lp-lead">
                Safe Zone plans project meetings across time zones: it suggests free slots, runs the vote, confirms the time
                and sends the calendar invite and video link. No more long email threads.
              </p>
              <div className="lp-cta-row">
                {user
                  ? <Link to="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">Go to your dashboard</Link>
                  : <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">Create an account</Link>}
                <a href="#how" className="lp-btn lp-btn-ghost lp-btn-lg">See how it works</a>
              </div>
            </div>
            <PollPreview />
          </div>
        </section>

        <section id="why" className="lp-section lp-section-alt" aria-labelledby="why-title">
          <div className="lp-container">
            <h2 id="why-title" className="lp-h2">Why Safe Zone?</h2>
            <p className="lp-section-lead">Planning meetings in a project team usually goes wrong in the same three ways.</p>
            <div className="lp-grid lp-grid-3">
              {PROBLEMS.map(p => (
                <article key={p.problem} className="lp-card lp-problem">
                  <span className="lp-icon lp-icon-muted"><i className={`bi ${p.icon}`} aria-hidden="true"></i></span>
                  <h3 className="lp-h3">{p.problem}</h3>
                  <p>{p.text}</p>
                  <p className="lp-answer"><i className="bi bi-arrow-right-circle-fill" aria-hidden="true"></i>{p.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="lp-section" aria-labelledby="features-title">
          <div className="lp-container">
            <h2 id="features-title" className="lp-h2">What you can do</h2>
            <p className="lp-section-lead">Everything a project team needs around its meetings, in one place.</p>
            <div className="lp-grid">
              {FEATURES.map(f => (
                <article key={f.title} className="lp-card">
                  <span className="lp-icon"><i className={`bi ${f.icon}`} aria-hidden="true"></i></span>
                  <h3 className="lp-h3">{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-alt" aria-labelledby="how-title">
          <div className="lp-container">
            <h2 id="how-title" className="lp-h2">How it works</h2>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="lp-step">
                  <span className="lp-step-num" aria-hidden="true">{i + 1}</span>
                  <h3 className="lp-h3">{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="security" className="lp-section" aria-labelledby="security-title">
          <div className="lp-container lp-security">
            <div>
              <h2 id="security-title" className="lp-h2">Built with security in mind</h2>
              <p className="lp-section-lead lp-left">Project data and calendar access are protected, and administrators can see what happens in the system.</p>
            </div>
            <ul className="lp-checks">
              {SECURITY.map(s => <li key={s}><i className="bi bi-check2-circle" aria-hidden="true"></i>{s}</li>)}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-final">
          <div className="lp-container lp-final-inner">
            <h2 className="lp-h2">Ready to plan your next meeting?</h2>
            <p className="lp-section-lead">It takes a minute to create an account.</p>
            <div className="lp-cta-row lp-center">
              {user
                ? <Link to="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">Open the app</Link>
                : <>
                    <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">Sign up</Link>
                    <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">I already have an account</Link>
                  </>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-logo lp-logo-sm"><BrandLogo size={32} /></span>
          <span className="lp-muted lp-small">Project meeting scheduling and management platform · Bachelor’s thesis, Vilnius University, 2026</span>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
