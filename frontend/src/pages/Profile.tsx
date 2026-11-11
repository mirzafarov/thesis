import { useCallback, useContext, useEffect, useState } from 'react';
import { Container, Card, Button, Modal, Badge, Table, Form, Alert, Row, Col } from 'react-bootstrap';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import TwoFactorSetup, { RecoveryCodes } from '../components/security/TwoFactorSetup';
import { allTimeZones, browserTimeZone } from '../lib/time';

interface Me {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  consentAt: string | null;
  consentVersion: string | null;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  recoveryCodesLeft: number;
  sessionIdleMinutes: number;
  timeZone: string | null;
  workdayStart: number;
  workdayEnd: number;
}

/** Time zone and working hours: used to find meeting times that suit everyone. */
const WorkingHoursCard = ({ me, onSaved }: { me: Me; onSaved: () => void }) => {
  const [tz, setTz] = useState(me.timeZone || browserTimeZone());
  const [start, setStart] = useState(me.workdayStart);
  const [end, setEnd] = useState(me.workdayEnd);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = allTimeZones();
  const hours = Array.from({ length: 25 }, (_, h) => h);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.put('/api/users/me/preferences', { timeZone: tz, workdayStart: start, workdayEnd: end });
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Could not save.' });
    }
  };

  return (
    <Card className="mb-4 saas-card">
      <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-globe2 me-2" aria-hidden="true"></i>Time zone & working hours</h5></Card.Header>
      <Card.Body>
        <p className="small" style={{ color: 'var(--text-secondary)' }}>
          Meeting suggestions only use times inside everyone's working hours (Monday–Friday, in their own time zone), and meeting times are shown in each person's zone.
        </p>
        {msg && <Alert variant={msg.ok ? 'success' : 'danger'} className="py-2">{msg.text}</Alert>}
        <Form onSubmit={save}>
          <Form.Group className="mb-3" controlId="pref-tz">
            <Form.Label>Time zone</Form.Label>
            <Form.Select value={tz} onChange={e => setTz(e.target.value)}>
              {!zones.includes(tz) && <option value={tz}>{tz}</option>}
              {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </Form.Select>
            {tz !== browserTimeZone() && (
              <Form.Text>This computer is set to {browserTimeZone().replace(/_/g, ' ')}. <Button variant="link" size="sm" className="p-0 align-baseline" onClick={() => setTz(browserTimeZone())}>Use it</Button></Form.Text>
            )}
          </Form.Group>
          <Row>
            <Col xs={6}>
              <Form.Group className="mb-3" controlId="pref-start">
                <Form.Label>Working day starts</Form.Label>
                <Form.Select value={start} onChange={e => setStart(Number(e.target.value))}>
                  {hours.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={6}>
              <Form.Group className="mb-3" controlId="pref-end">
                <Form.Label>Working day ends</Form.Label>
                <Form.Select value={end} onChange={e => setEnd(Number(e.target.value))}>
                  {hours.slice(1).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
          <Button type="submit" disabled={start >= end}>Save</Button>
        </Form>
      </Card.Body>
    </Card>
  );
};

interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface ActivityRow {
  id: string;
  action: string;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

// "Mozilla/5.0 (Windows NT 10.0; ...) Chrome/..." -> "Chrome on Windows"
function describeDevice(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|curl/i.test(ua) ? 'Script / API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const formatIp = (ip: string | null) => {
  if (!ip) return 'Unknown';
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return '127.0.0.1 (this computer)';
  return ip.replace('::ffff:', '');
};

const when = (iso: string) => new Date(iso).toLocaleString();

const Profile = () => {
  const { logout } = useContext(AuthContext);
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [error, setError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [codeDialog, setCodeDialog] = useState<null | 'recovery' | 'disable'>(null);
  const [dialogCode, setDialogCode] = useState('');
  const [dialogPassword, setDialogPassword] = useState('');
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    try {
      const [meRes, sessionsRes, activityRes] = await Promise.all([
        axios.get('/api/auth/me'),
        axios.get('/api/auth/sessions'),
        axios.get('/api/auth/me/activity'),
      ]);
      setMe(meRes.data);
      setSessions(sessionsRes.data);
      setActivity(activityRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load your settings.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const endSession = async (id: string) => {
    await axios.delete(`/api/auth/sessions/${id}`).catch(() => {});
    load();
  };

  const endOtherSessions = async () => {
    await axios.post('/api/auth/sessions/revoke-others').catch(() => {});
    load();
  };

  const submitCodeDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    setDialogError('');
    try {
      if (codeDialog === 'recovery') {
        const res = await axios.post('/api/auth/2fa/recovery-codes', { code: dialogCode });
        setNewCodes(res.data.recoveryCodes);
      } else {
        await axios.post('/api/auth/2fa/disable', { code: dialogCode, password: dialogPassword });
      }
      setCodeDialog(null);
      load();
    } catch (err: any) {
      setDialogError(err.response?.data?.error || 'That did not work. Please try again.');
    }
  };

  const handleExportData = async () => {
    try {
      const res = await axios.get('/api/auth/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my_data.json';
      a.click();
      URL.revokeObjectURL(url);
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to export data');
    }
  };

  const confirmDeleteAccount = async () => {
    try {
      await axios.delete('/api/auth/me');
      logout();
    } catch (err) {
      console.error(err);
      alert('Failed to delete account');
    }
  };

  const openDialog = (kind: 'recovery' | 'disable') => {
    setDialogCode('');
    setDialogPassword('');
    setDialogError('');
    setCodeDialog(kind);
  };

  return (
    <Container fluid className="p-2">
      <h2 className="mb-4 saas-heading">Settings</h2>
      {error && <Alert variant="danger">{error}</Alert>}

      <Row>
        <Col xl={6}>
          {/* Two-factor authentication */}
          <Card className="mb-4 saas-card">
            <Card.Header className="bg-transparent py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 saas-heading"><i className="bi bi-shield-lock me-2" aria-hidden="true"></i>Two-factor login</h5>
              {me && (me.twoFactorEnabled ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>)}
            </Card.Header>
            <Card.Body>
              {!me ? null : newCodes ? (
                <RecoveryCodes codes={newCodes} onDone={() => setNewCodes(null)} />
              ) : showSetup ? (
                <TwoFactorSetup onEnabled={() => { setShowSetup(false); load(); }} />
              ) : me.twoFactorEnabled ? (
                <>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    When you log in, you enter a code from your authenticator app after your password.
                    You have <strong>{me.recoveryCodesLeft}</strong> unused recovery code{me.recoveryCodesLeft === 1 ? '' : 's'}.
                  </p>
                  {me.recoveryCodesLeft <= 3 && <Alert variant="warning" className="py-2">You are running out of recovery codes. Create new ones.</Alert>}
                  <div className="d-flex flex-wrap gap-2">
                    <Button variant="outline-primary" size="sm" onClick={() => openDialog('recovery')}>New recovery codes</Button>
                    {!me.twoFactorRequired && (
                      <Button variant="outline-danger" size="sm" onClick={() => openDialog('disable')}>Turn off</Button>
                    )}
                  </div>
                  {me.twoFactorRequired && <p className="small mt-3 mb-0" style={{ color: 'var(--text-secondary)' }}>Required for your role (administrator or project manager), so it cannot be turned off.</p>}
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Add a second step to your login: a 6-digit code from an app on your phone. Even if someone learns your password, they cannot log in without your phone.
                  </p>
                  <Button onClick={() => setShowSetup(true)}>Set up two-factor login</Button>
                </>
              )}
            </Card.Body>
          </Card>

          {/* Active sessions */}
          <Card className="mb-4 saas-card">
            <Card.Header className="bg-transparent py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 saas-heading"><i className="bi bi-laptop me-2" aria-hidden="true"></i>Where you're logged in</h5>
              {sessions.length > 1 && <Button variant="outline-danger" size="sm" onClick={endOtherSessions}>Log out all other devices</Button>}
            </Card.Header>
            <Card.Body>
              <p className="small" style={{ color: 'var(--text-secondary)' }}>
                Sessions end automatically after {me?.sessionIdleMinutes ?? 30} minutes of inactivity. If you don't recognise a device, end it and change your password.
              </p>
              {sessions.map(s => (
                <div key={s.id} className="border rounded p-3 mb-2 d-flex justify-content-between align-items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div className="fw-semibold" style={{ color: 'var(--text-primary)' }}>
                      {describeDevice(s.userAgent)}
                      {s.current && <Badge bg="success" className="ms-2">This device</Badge>}
                    </div>
                    <div className="small" style={{ color: 'var(--text-secondary)' }}>
                      IP {formatIp(s.ipAddress)} · logged in {when(s.createdAt)} · last active {when(s.lastSeenAt)}
                    </div>
                  </div>
                  {s.current ? (
                    <Button className="saas-btn-outline-danger btn-sm" onClick={() => logout()}>Log out</Button>
                  ) : (
                    <Button variant="outline-danger" size="sm" onClick={() => endSession(s.id)}>End</Button>
                  )}
                </div>
              ))}
            </Card.Body>
          </Card>
        </Col>

        <Col xl={6}>
          {me && <WorkingHoursCard key={`${me.timeZone}-${me.workdayStart}-${me.workdayEnd}`} me={me} onSaved={load} />}

          {/* Account and GDPR */}
          <Card className="mb-4 saas-card">
            <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-person-badge me-2" aria-hidden="true"></i>Account & privacy (GDPR)</h5></Card.Header>
            <Card.Body>
              {me && (
                <dl className="row small mb-3" style={{ color: 'var(--text-primary)' }}>
                  <dt className="col-sm-4">Name</dt><dd className="col-sm-8">{me.firstName} {me.lastName}</dd>
                  <dt className="col-sm-4">Email</dt><dd className="col-sm-8">{me.email}</dd>
                  <dt className="col-sm-4">Phone</dt><dd className="col-sm-8">{me.phone || '—'}</dd>
                  <dt className="col-sm-4">Privacy consent</dt>
                  <dd className="col-sm-8">{me.consentAt ? `Version ${me.consentVersion}, accepted ${when(me.consentAt)}` : 'Accepted before consent tracking was introduced'}</dd>
                </dl>
              )}
              <div className="d-flex flex-wrap gap-2">
                <Button className="saas-btn-outline-primary" onClick={handleExportData}><i className="bi bi-download me-2" aria-hidden="true"></i>Export My Data (JSON)</Button>
                <Button className="saas-btn-outline-danger" onClick={() => setShowDeleteModal(true)}><i className="bi bi-trash me-2" aria-hidden="true"></i>Delete Account</Button>
              </div>
            </Card.Body>
          </Card>

          {/* Own audit trail */}
          <Card className="mb-4 saas-card">
            <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-clock-history me-2" aria-hidden="true"></i>My recent activity</h5></Card.Header>
            <Card.Body className="p-0" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <Table size="sm" className="mb-0" responsive>
                <thead><tr><th className="ps-3">When</th><th>Action</th><th>Details</th><th className="pe-3">IP</th></tr></thead>
                <tbody>
                  {activity.map(a => (
                    <tr key={a.id}>
                      <td className="ps-3 text-nowrap small">{when(a.createdAt)}</td>
                      <td><Badge bg={/FAILED|DELETE|REVOKED/.test(a.action) ? 'danger' : /2FA|PASSWORD/.test(a.action) ? 'warning' : 'secondary'}>{a.action}</Badge></td>
                      <td className="small">{a.details}</td>
                      <td className="pe-3 small text-nowrap">{formatIp(a.ipAddress)}</td>
                    </tr>
                  ))}
                  {activity.length === 0 && <tr><td colSpan={4} className="text-center text-muted py-4">No activity yet.</td></tr>}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Code dialog: new recovery codes / turn off 2FA */}
      <Modal show={!!codeDialog} onHide={() => setCodeDialog(null)} centered>
        <Form onSubmit={submitCodeDialog}>
          <Modal.Header closeButton>
            <Modal.Title>{codeDialog === 'recovery' ? 'New recovery codes' : 'Turn off two-factor login'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {dialogError && <Alert variant="danger">{dialogError}</Alert>}
            <p className="small text-muted">
              {codeDialog === 'recovery' ? 'Your old recovery codes will stop working.' : 'Your account will be protected by your password only.'}
            </p>
            {codeDialog === 'disable' && (
              <Form.Group className="mb-3" controlId="dlg-password">
                <Form.Label>Password</Form.Label>
                <Form.Control type="password" autoComplete="current-password" required value={dialogPassword} onChange={e => setDialogPassword(e.target.value)} />
              </Form.Group>
            )}
            <Form.Group controlId="dlg-code">
              <Form.Label>Current 6-digit code from your app</Form.Label>
              <Form.Control required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={dialogCode} onChange={e => setDialogCode(e.target.value.replace(/\D/g, ''))} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setCodeDialog(null)}>Cancel</Button>
            <Button type="submit" variant={codeDialog === 'disable' ? 'danger' : 'primary'}>{codeDialog === 'recovery' ? 'Create new codes' : 'Turn off'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Delete Account Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>Delete Account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>WARNING: Are you sure you want to permanently delete your account?</p>
          <p className="text-muted small">This action cannot be undone and complies with GDPR Right to be Forgotten. All your personal data will be erased.</p>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} className="rounded-pill px-4">Cancel</Button>
          <Button variant="danger" onClick={confirmDeleteAccount} className="rounded-pill px-4 shadow-sm">Confirm Deletion</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Profile;
