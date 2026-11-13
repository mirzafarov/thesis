// Home page after login: a short overview (numbers), what needs the user's vote, and the next meetings.
// Uses the same colour tokens as the landing page (index.css); layout styles are in dashboard.css.
import { useEffect, useState, useContext } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { JoinButton, providerName } from '../components/meetings/VideoCall';
import { browserTimeZone, formatInZone } from '../lib/time';
import './dashboard.css';

const SCHEDULED = ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'];

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
  </svg>
);

/** One number card. All cards share one style; only the icon and text differ. */
const StatCard = ({ icon, label, value, to, linkText, note }: { icon: string; label: string; value: number; to: string; linkText: string; note?: string }) => (
  <div className="db-card db-stat">
    <div className="db-stat-head">
      <span className="db-icon"><i className={`bi ${icon}`} aria-hidden="true"></i></span>
      <span className="db-stat-label">{label}</span>
    </div>
    <div className="db-stat-value">{value}</div>
    {note && <span className="db-note"><i className="bi bi-exclamation-circle" aria-hidden="true"></i>{note}</span>}
    <Link to={to} className="db-link">{linkText} <i className="bi bi-arrow-right" aria-hidden="true"></i></Link>
  </div>
);

const Dashboard = () => {
  const [serverReachable, setServerReachable] = useState(true);
  const [projectsCount, setProjectsCount] = useState(0);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [pendingPolls, setPendingPolls] = useState<any[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; email?: string }>({ connected: false });
  const [loaded, setLoaded] = useState(false);
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  // Administrators have their own start page (the admin panel also shows the system status).
  useEffect(() => {
    if (user?.role === 'ADMIN') navigate('/admin');
  }, [user, navigate]);

  const fetchDashboardData = () => {
    if (!user) return;
    Promise.all([
      axios.get('/api/projects'),
      axios.get('/api/meetings'),
      axios.get('/api/meetings/polls/pending'),
      axios.get('/api/calendar/status'),
    ]).then(([projectsRes, meetingsRes, pollsRes, calRes]) => {
      setProjectsCount(projectsRes.data.length);
      setUpcoming(
        meetingsRes.data
          .filter((m: any) => SCHEDULED.includes(m.status) && new Date(m.endDate ?? m.startDate) >= new Date())
          .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()),
      );
      setPendingPolls(pollsRes.data);
      setCalendarStatus(calRes.data);
      setLoaded(true);
    }).catch(console.error);
  };

  useEffect(() => {
    // Ordinary users only need to know when the server cannot be reached; the technical details stay hidden.
    axios.get('/api/health').then(() => setServerReachable(true)).catch(() => setServerReachable(false));

    fetchDashboardData();

    // Refresh when the user comes back to the tab or finishes connecting Google in the pop-up window.
    const handleFocus = () => fetchDashboardData();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'oauth_status') fetchDashboardData();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user]);

  const handleConnectCalendar = async () => {
    try {
      const res = await axios.get('/api/calendar/google/auth');
      window.open(res.data.url, 'googleAuth', 'width=500,height=600');
    } catch (err) {
      console.error('Failed to get auth URL', err);
    }
  };

  const handleDisconnectCalendar = async () => {
    try {
      await axios.delete('/api/calendar/disconnect');
      fetchDashboardData();
    } catch (err) {
      console.error('Failed to disconnect calendar', err);
    }
  };

  const zone = browserTimeZone();

  return (
    <div className="db">
      <header className="db-header">
        <div>
          <h1 className="db-title">Welcome back, {user?.firstName}</h1>
          <p className="db-subtitle">Here is what is happening in your projects.</p>
        </div>
        {calendarStatus.connected ? (
          <div className="db-calendar">
            <GoogleIcon />
            <span className="db-calendar-text">
              <span className="db-calendar-title">Google Calendar connected</span>
              <span className="db-calendar-email">{calendarStatus.email}</span>
            </span>
            <Button variant="link" size="sm" className="db-calendar-disconnect" onClick={handleDisconnectCalendar}>Disconnect</Button>
          </div>
        ) : (
          <button type="button" className="db-google-btn" onClick={handleConnectCalendar}>
            <GoogleIcon /> Connect Google Calendar
          </button>
        )}
      </header>

      {!serverReachable && (
        <Alert variant="warning" className="db-alert">
          <i className="bi bi-wifi-off me-2" aria-hidden="true"></i>
          Safe Zone cannot reach the server right now, so some information may be missing. Please try again in a moment.
        </Alert>
      )}

      <section className="db-stats" aria-label="Overview">
        <StatCard icon="bi-calendar-check" label="Upcoming meetings" value={upcoming.length} to="/meetings" linkText="View schedule" />
        <StatCard icon="bi-folder" label="Active projects" value={projectsCount} to="/projects" linkText="View projects" />
        <StatCard icon="bi-ui-radios" label="Pending polls" value={pendingPolls.length} to="/meetings" linkText="Go to meetings"
          note={pendingPolls.length > 0 ? 'Waiting for your vote' : undefined} />
      </section>

      <div className="db-columns">
        <section className="db-card db-panel" aria-labelledby="db-polls-title">
          <h2 id="db-polls-title" className="db-panel-title">Needs your vote</h2>
          {pendingPolls.length === 0 ? (
            <p className="db-empty"><i className="bi bi-check2-circle" aria-hidden="true"></i>{loaded ? 'You are all caught up.' : 'Loading…'}</p>
          ) : (
            <ul className="db-list">
              {pendingPolls.map(poll => (
                <li key={poll.id} className="db-row">
                  <div className="db-row-main">
                    <div className="db-row-title">{poll.meeting.title}</div>
                    <div className="db-row-sub"><i className="bi bi-folder2-open" aria-hidden="true"></i>{poll.meeting.project.name}</div>
                  </div>
                  <Link to="/meetings" className="btn btn-primary btn-sm db-row-action">Vote on times</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="db-card db-panel" aria-labelledby="db-next-title">
          <h2 id="db-next-title" className="db-panel-title">Next meetings</h2>
          {upcoming.length === 0 ? (
            <p className="db-empty"><i className="bi bi-calendar" aria-hidden="true"></i>
              {loaded ? <span>No meetings scheduled. <Link to="/meetings">Schedule one</Link></span> : 'Loading…'}
            </p>
          ) : (
            <ul className="db-list">
              {upcoming.slice(0, 3).map(m => (
                <li key={m.id} className="db-row">
                  <div className="db-row-main">
                    <div className="db-row-title">{m.title}</div>
                    <div className="db-row-sub">
                      <i className="bi bi-clock" aria-hidden="true"></i>{formatInZone(m.startDate, zone)} · {m.durationMin} min · {providerName(m.videoProvider)}
                    </div>
                  </div>
                  <div className="db-row-action"><JoinButton meeting={m} /></div>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 3 && <Link to="/meetings" className="db-link mt-3">All {upcoming.length} meetings <i className="bi bi-arrow-right" aria-hidden="true"></i></Link>}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
