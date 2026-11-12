// Administrator home: security overview of the whole system.
import { useEffect, useState } from 'react';
import { Alert, Card, Col, Container, Row, Spinner, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ActionBadge, StatCard, formatIp, tdStyle, thStyle, when } from './adminUi';

interface Overview {
  users: { total: number; admins: number; verified: number; with2fa: number; blocked: number; locked: number; missing2fa: number };
  activity: { activeSessions: number; loginsToday: number; failed24h: number; failed2fa24h: number; locks24h: number; resets24h: number };
  suspiciousIps: { ipAddress: string | null; attempts: number }[];
  incidents: { id: string; action: string; details: string | null; ipAddress: string | null; createdAt: string; user: { email: string } | null }[];
  integrations: { email: string; googleCalendar: string; ai: string };
  settings: { require2faForManagers: boolean; loginMaxAttempts: number; loginLockMinutes: number; sessionIdleMinutes: number; passwordMinLength: number };
}

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/admin/overview').then(r => setData(r.data)).catch(e => setError(e.response?.data?.error || 'Could not load the overview.'));
  }, []);

  if (error) return <Container fluid className="p-2 p-md-4"><Alert variant="danger">{error}</Alert></Container>;
  if (!data) return <div className="p-5 text-center"><Spinner animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>;

  const { users, activity, settings } = data;
  return (
    <Container fluid className="p-2 p-md-4">
      <h2 className="mb-1 saas-heading fw-bold">Security overview</h2>
      <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>System-wide accounts, logins and security incidents. Administrators do not see project content.</p>

      {users.missing2fa > 0 && settings.require2faForManagers && (
        <Alert variant="warning">
          <i className="bi bi-shield-exclamation me-2" aria-hidden="true"></i>
          {users.missing2fa} manager/administrator account{users.missing2fa === 1 ? '' : 's'} without two-factor login. They will be asked to set it up at their next login.
        </Alert>
      )}

      <h6 className="text-uppercase small fw-bold mb-2" style={{ color: 'var(--text-secondary)' }}>Accounts</h6>
      <Row className="g-3 mb-4">
        <Col xs={6} lg={3}><StatCard icon="bi-people" label="Users" value={users.total} /></Col>
        <Col xs={6} lg={3}><StatCard icon="bi-shield-check" label="With two-factor login" value={`${users.with2fa} / ${users.total}`} /></Col>
        <Col xs={6} lg={3}><StatCard icon="bi-lock" label="Locked (wrong passwords)" value={users.locked} tone={users.locked ? 'warning' : undefined} /></Col>
        <Col xs={6} lg={3}><StatCard icon="bi-slash-circle" label="Blocked by admin" value={users.blocked} tone={users.blocked ? 'danger' : undefined} /></Col>
      </Row>

      <h6 className="text-uppercase small fw-bold mb-2" style={{ color: 'var(--text-secondary)' }}>Activity</h6>
      <Row className="g-3 mb-4">
        <Col xs={6} lg={2}><StatCard icon="bi-laptop" label="Active sessions" value={activity.activeSessions} /></Col>
        <Col xs={6} lg={2}><StatCard icon="bi-box-arrow-in-right" label="Logins today" value={activity.loginsToday} /></Col>
        <Col xs={6} lg={2}><StatCard icon="bi-x-octagon" label="Failed logins (24 h)" value={activity.failed24h} tone={activity.failed24h ? 'danger' : undefined} /></Col>
        <Col xs={6} lg={2}><StatCard icon="bi-123" label="Wrong 2FA codes (24 h)" value={activity.failed2fa24h} tone={activity.failed2fa24h ? 'danger' : undefined} /></Col>
        <Col xs={6} lg={2}><StatCard icon="bi-lock-fill" label="Lockouts (24 h)" value={activity.locks24h} tone={activity.locks24h ? 'warning' : undefined} /></Col>
        <Col xs={6} lg={2}><StatCard icon="bi-key" label="Password resets (24 h)" value={activity.resets24h} /></Col>
      </Row>

      <Row className="g-4">
        <Col xl={8}>
          <Card className="saas-card h-100">
            <Card.Header className="bg-transparent py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 saas-heading">Recent security incidents</h5>
              <Link to="/admin/logs?group=security" className="small">All security events →</Link>
            </Card.Header>
            <Card.Body className="p-0">
              <Table responsive hover className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
                <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Event</th><th style={thStyle}>Account</th><th style={thStyle}>IP</th><th style={thStyle}>Details</th></tr></thead>
                <tbody>
                  {data.incidents.length === 0 && <tr><td colSpan={5} className="text-center py-4" style={{ color: 'var(--text-secondary)' }}>No incidents. 🎉</td></tr>}
                  {data.incidents.map(i => (
                    <tr key={i.id}>
                      <td style={tdStyle} className="small text-nowrap">{when(i.createdAt)}</td>
                      <td style={tdStyle}><ActionBadge action={i.action} /></td>
                      <td style={tdStyle} className="small">{i.user?.email ?? '—'}</td>
                      <td style={tdStyle} className="small text-nowrap">{formatIp(i.ipAddress)}</td>
                      <td style={tdStyle} className="small">{i.details}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={4}>
          <Card className="saas-card mb-4">
            <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading">Suspicious IP addresses (24 h)</h5></Card.Header>
            <Card.Body>
              {data.suspiciousIps.length === 0 ? (
                <p className="mb-0 small" style={{ color: 'var(--text-secondary)' }}>No IP address with 3 or more failed attempts.</p>
              ) : (
                <ul className="list-unstyled mb-0">
                  {data.suspiciousIps.map(s => (
                    <li key={s.ipAddress ?? 'unknown'} className="d-flex justify-content-between py-1">
                      <Link to={`/admin/logs?ip=${encodeURIComponent(s.ipAddress ?? '')}&group=logins`} className="small">{formatIp(s.ipAddress)}</Link>
                      <span className="badge text-bg-danger">{s.attempts} failed</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Body>
          </Card>
          <Card className="saas-card">
            <Card.Header className="bg-transparent py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 saas-heading">Configuration</h5>
              <Link to="/admin/settings" className="small">Change →</Link>
            </Card.Header>
            <Card.Body className="small" style={{ color: 'var(--text-primary)' }}>
              <div className="d-flex justify-content-between py-1"><span>2FA for managers &amp; admins</span><b>{settings.require2faForManagers ? 'Required' : 'Optional'}</b></div>
              <div className="d-flex justify-content-between py-1"><span>Account lock</span><b>{settings.loginMaxAttempts} attempts → {settings.loginLockMinutes} min</b></div>
              <div className="d-flex justify-content-between py-1"><span>Logout after inactivity</span><b>{settings.sessionIdleMinutes} min</b></div>
              <div className="d-flex justify-content-between py-1"><span>Minimum password length</span><b>{settings.passwordMinLength}</b></div>
              <hr />
              {(['email', 'googleCalendar', 'ai'] as const).map(k => (
                <div key={k} className="d-flex justify-content-between py-1">
                  <span>{{ email: 'Email (SMTP)', googleCalendar: 'Google Calendar', ai: 'AI assistant (Gemini)' }[k]}</span>
                  <b className={data.integrations[k] === 'configured' ? 'text-success' : 'text-warning'}>{data.integrations[k]}</b>
                </div>
              ))}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
