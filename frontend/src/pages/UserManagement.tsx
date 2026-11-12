// User management for administrators: status at a glance and account actions (each one is audited).
import { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Container, Dropdown, Form, Modal, Spinner, Table } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { formatIp, tdStyle, thStyle, when } from './admin/adminUi';

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  systemRole: 'ADMIN' | 'USER';
  createdAt: string;
  emailVerifiedAt: string | null;
  totpEnabledAt: string | null;
  blockedAt: string | null;
  blockedReason: string | null;
  lockedUntil: string | null;
  locked: boolean;
  projects: number;
  managesProjects: boolean;
  activeSessions: number;
  lastLogin: { createdAt: string; ipAddress: string | null } | null;
}

type ActionKind = 'block' | 'unblock' | 'unlock' | 'logout' | 'reset-2fa' | 'resend-verification' | 'make-admin' | 'make-user';

const ACTIONS: Record<ActionKind, { title: string; explain: (u: AdminUser) => string; confirm: string; variant: string }> = {
  block: { title: 'Block account', explain: u => `${u.email} will not be able to log in, and all their sessions end now.`, confirm: 'Block', variant: 'danger' },
  unblock: { title: 'Unblock account', explain: u => `${u.email} will be able to log in again.`, confirm: 'Unblock', variant: 'primary' },
  unlock: { title: 'Unlock login', explain: u => `Lifts the temporary lock after too many wrong passwords for ${u.email}.`, confirm: 'Unlock', variant: 'primary' },
  logout: { title: 'Log out everywhere', explain: u => `Ends all ${u.activeSessions} active session(s) of ${u.email}.`, confirm: 'Log out', variant: 'warning' },
  'reset-2fa': { title: 'Reset two-factor login', explain: u => `Removes the authenticator and recovery codes of ${u.email} (for example after a lost phone). They set it up again at their next login. Their sessions end now.`, confirm: 'Reset 2FA', variant: 'danger' },
  'resend-verification': { title: 'Resend confirmation email', explain: u => `Sends a new email-confirmation link to ${u.email}.`, confirm: 'Send', variant: 'primary' },
  'make-admin': { title: 'Make administrator', explain: u => `${u.email} gets full access to the admin panel (logs, users, settings). Their sessions end so the change applies at once.`, confirm: 'Make admin', variant: 'danger' },
  'make-user': { title: 'Remove administrator rights', explain: u => `${u.email} becomes a normal user. Their sessions end so the change applies at once.`, confirm: 'Remove admin', variant: 'warning' },
};

const STATUS_FILTERS = [
  ['', 'All'], ['blocked', 'Blocked'], ['locked', 'Locked'], ['unverified', 'Unconfirmed email'], ['no2fa', 'No 2FA'], ['admins', 'Admins'],
] as const;

const UserManagement = () => {
  const { user: me } = useContext(AuthContext);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ kind: ActionKind; user: AdminUser } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/users', { params: { q: q || undefined, status: status || undefined } });
      setUsers(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load users.');
    }
  }, [q, status]);

  useEffect(() => {
    const t = window.setTimeout(load, 250); // small debounce while typing
    return () => window.clearTimeout(t);
  }, [load]);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    const { kind, user } = pending;
    try {
      if (kind === 'make-admin' || kind === 'make-user') {
        await axios.put(`/api/admin/users/${user.id}/role`, { role: kind === 'make-admin' ? 'ADMIN' : 'USER' });
      } else {
        await axios.post(`/api/admin/users/${user.id}/${kind}`, kind === 'block' ? { reason } : {});
      }
      setNotice(`${ACTIONS[kind].title}: done for ${user.email}.`);
      setPending(null);
      setReason('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'That did not work.');
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const ask = (kind: ActionKind, user: AdminUser) => { setReason(''); setPending({ kind, user }); };

  return (
    <Container fluid className="p-2 p-md-4">
      <h2 className="mb-3 saas-heading fw-bold">User management</h2>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Form.Control style={{ maxWidth: 320 }} placeholder="Search name or email…" aria-label="Search users" value={q} onChange={e => setQ(e.target.value)} />
        <ButtonGroup size="sm" aria-label="Filter by status" className="flex-wrap">
          {STATUS_FILTERS.map(([k, label]) => (
            <Button key={k} variant={status === k ? 'primary' : 'outline-secondary'} aria-pressed={status === k} onClick={() => setStatus(k)}>{label}</Button>
          ))}
        </ButtonGroup>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert variant="success" dismissible onClose={() => setNotice('')}>{notice}</Alert>}

      <Card className="saas-card overflow-hidden border-0">
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
            <thead>
              <tr>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last login</th>
                <th style={thStyle}>Sessions</th>
                <th style={thStyle}>Projects</th>
                <th style={thStyle} aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {users === null && <tr><td colSpan={7} className="text-center py-5"><Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading…</span></Spinner></td></tr>}
              {(users ?? []).map(u => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td style={tdStyle}>
                      <div className="fw-semibold" style={{ color: 'var(--text-primary)' }}>{u.firstName} {u.lastName} {self && <Badge bg="info" className="ms-1">You</Badge>}</div>
                      <div className="small" style={{ color: 'var(--text-secondary)' }}>{u.email}</div>
                    </td>
                    <td style={tdStyle}>
                      <Badge bg={u.systemRole === 'ADMIN' ? 'primary' : 'secondary'}>{u.systemRole}</Badge>
                      {u.managesProjects && <Badge bg="light" text="dark" className="ms-1" title="Manager of at least one project">Manager</Badge>}
                    </td>
                    <td style={tdStyle} className="small">
                      <div className="d-flex flex-wrap gap-1">
                        {u.blockedAt && <Badge bg="danger" title={u.blockedReason ?? undefined}>Blocked</Badge>}
                        {u.locked && <Badge bg="warning" text="dark" title={`Until ${when(u.lockedUntil)}`}>Locked</Badge>}
                        {!u.emailVerifiedAt && <Badge bg="secondary">Email not confirmed</Badge>}
                        {u.totpEnabledAt ? <Badge bg="success">2FA</Badge> : <Badge bg="light" text="dark">No 2FA</Badge>}
                      </div>
                      {u.blockedReason && <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>“{u.blockedReason}”</div>}
                    </td>
                    <td style={tdStyle} className="small text-nowrap" title={u.lastLogin ? formatIp(u.lastLogin.ipAddress) : undefined}>
                      {u.lastLogin ? when(u.lastLogin.createdAt) : <span style={{ color: 'var(--text-secondary)' }}>Never</span>}
                    </td>
                    <td style={tdStyle} className="small">{u.activeSessions}</td>
                    <td style={tdStyle} className="small">{u.projects}</td>
                    <td style={tdStyle} className="text-end">
                      <Dropdown align="end">
                        <Dropdown.Toggle size="sm" variant="outline-secondary" id={`actions-${u.id}`}>Actions</Dropdown.Toggle>
                        <Dropdown.Menu>
                          {u.locked && <Dropdown.Item onClick={() => ask('unlock', u)}><i className="bi bi-unlock me-2" aria-hidden="true"></i>Unlock login</Dropdown.Item>}
                          {!u.emailVerifiedAt && <Dropdown.Item onClick={() => ask('resend-verification', u)}><i className="bi bi-envelope me-2" aria-hidden="true"></i>Resend confirmation email</Dropdown.Item>}
                          <Dropdown.Item onClick={() => ask('logout', u)} disabled={u.activeSessions === 0}><i className="bi bi-box-arrow-right me-2" aria-hidden="true"></i>Log out everywhere</Dropdown.Item>
                          <Dropdown.Item onClick={() => ask('reset-2fa', u)} disabled={!u.totpEnabledAt || self}><i className="bi bi-phone me-2" aria-hidden="true"></i>Reset two-factor login</Dropdown.Item>
                          <Dropdown.Divider />
                          {u.systemRole === 'USER'
                            ? <Dropdown.Item onClick={() => ask('make-admin', u)} disabled={self}><i className="bi bi-shield-plus me-2" aria-hidden="true"></i>Make administrator</Dropdown.Item>
                            : <Dropdown.Item onClick={() => ask('make-user', u)} disabled={self}><i className="bi bi-shield-minus me-2" aria-hidden="true"></i>Remove admin rights</Dropdown.Item>}
                          {u.blockedAt
                            ? <Dropdown.Item onClick={() => ask('unblock', u)}><i className="bi bi-check-circle me-2" aria-hidden="true"></i>Unblock account</Dropdown.Item>
                            : <Dropdown.Item className="text-danger" onClick={() => ask('block', u)} disabled={self}><i className="bi bi-slash-circle me-2" aria-hidden="true"></i>Block account</Dropdown.Item>}
                        </Dropdown.Menu>
                      </Dropdown>
                    </td>
                  </tr>
                );
              })}
              {users?.length === 0 && <tr><td colSpan={7} className="text-center py-5" style={{ color: 'var(--text-secondary)' }}>No users match.</td></tr>}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Modal show={!!pending} onHide={() => setPending(null)} centered>
        {pending && (
          <>
            <Modal.Header closeButton><Modal.Title>{ACTIONS[pending.kind].title}</Modal.Title></Modal.Header>
            <Modal.Body>
              <p className="mb-3">{ACTIONS[pending.kind].explain(pending.user)}</p>
              {pending.kind === 'block' && (
                <Form.Group controlId="block-reason">
                  <Form.Label>Reason (stored in the audit log)</Form.Label>
                  <Form.Control maxLength={200} placeholder="e.g. Suspicious activity reported by the user" value={reason} onChange={e => setReason(e.target.value)} />
                </Form.Group>
              )}
              <p className="small mb-0 mt-3" style={{ color: 'var(--text-secondary)' }}>This action is recorded in the audit log with your name and IP address.</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
              <Button variant={ACTIONS[pending.kind].variant} onClick={run} disabled={busy}>{busy ? 'Working…' : ACTIONS[pending.kind].confirm}</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </Container>
  );
};

export default UserManagement;
