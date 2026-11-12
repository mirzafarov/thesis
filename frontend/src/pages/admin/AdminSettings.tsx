// System settings for administrators: security policy that applies immediately (stored in the database).
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Container, Form, Row, Spinner } from 'react-bootstrap';
import axios from 'axios';

interface Settings {
  require2faForManagers: boolean;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  checkBreachedPasswords: boolean;
  sessionIdleMinutes: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  privacyPolicyVersion: string;
}

type Limits = Record<'passwordMinLength' | 'sessionIdleMinutes' | 'loginMaxAttempts' | 'loginLockMinutes', [number, number]>;

export default function AdminSettings() {
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get('/api/admin/settings').then(r => {
      setForm(r.data.settings);
      setSaved(r.data.settings);
      setDefaults(r.data.defaults);
      setLimits(r.data.limits);
    }).catch(e => setMessage({ ok: false, text: e.response?.data?.error || 'Could not load settings.' }));
  }, []);

  if (!form || !limits) {
    return message ? <Container className="p-4"><Alert variant="danger">{message.text}</Alert></Container>
      : <div className="p-5 text-center"><Spinner animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>;
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const r = await axios.put('/api/admin/settings', form);
      setForm(r.data.settings);
      setSaved(r.data.settings);
      setMessage({ ok: true, text: r.data.changed.length ? `Saved: ${r.data.changed.length} setting(s) changed. They apply immediately.` : 'Nothing changed.' });
    } catch (err: any) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const num = (k: keyof Limits, label: string, unit: string, help: string) => (
    <Form.Group className="mb-3" controlId={`set-${k}`}>
      <Form.Label className="fw-semibold">{label}</Form.Label>
      <div className="d-flex align-items-center gap-2">
        <Form.Control type="number" min={limits[k][0]} max={limits[k][1]} value={form[k]} style={{ maxWidth: 120 }}
          onChange={e => set(k, Number(e.target.value))} required />
        <span style={{ color: 'var(--text-secondary)' }}>{unit}</span>
      </div>
      <Form.Text>{help} Allowed: {limits[k][0]}–{limits[k][1]}.</Form.Text>
    </Form.Group>
  );
  const sw = (k: keyof Settings, label: string, help?: string) => (
    <Form.Group className="mb-3" controlId={`set-${k}`}>
      <Form.Check type="switch" label={label} checked={form[k] as boolean} onChange={e => set(k, e.target.checked as never)} />
      {help && <Form.Text>{help}</Form.Text>}
    </Form.Group>
  );

  return (
    <Container fluid className="p-2 p-md-4">
      <h2 className="mb-1 saas-heading fw-bold">System settings</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Security policy for all users. Changes apply immediately and are recorded in the audit log.</p>
      {message && <Alert variant={message.ok ? 'success' : 'danger'} dismissible onClose={() => setMessage(null)}>{message.text}</Alert>}

      <Form onSubmit={save}>
        <Row className="g-4">
          <Col lg={6}>
            <Card className="saas-card mb-4">
              <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-shield-lock me-2" aria-hidden="true"></i>Login protection</h5></Card.Header>
              <Card.Body>
                {sw('require2faForManagers', 'Require two-factor login for administrators and project managers',
                  'When on, they must set up an authenticator app at their next login and cannot turn it off.')}
                {num('loginMaxAttempts', 'Lock an account after', 'wrong passwords in a row', 'Protects against password guessing.')}
                {num('loginLockMinutes', 'Lock duration', 'minutes', 'Administrators can unlock an account earlier in User management.')}
                {num('sessionIdleMinutes', 'Log users out after', 'minutes of inactivity', 'Applies to all active sessions.')}
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6}>
            <Card className="saas-card mb-4">
              <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-key me-2" aria-hidden="true"></i>Password policy</h5></Card.Header>
              <Card.Body>
                {num('passwordMinLength', 'Minimum length', 'characters', 'Applies to new passwords (sign-up and reset).')}
                {sw('passwordRequireUppercase', 'Require an uppercase letter')}
                {sw('passwordRequireLowercase', 'Require a lowercase letter')}
                {sw('passwordRequireNumber', 'Require a number')}
                {sw('passwordRequireSymbol', 'Require a special character')}
                {sw('checkBreachedPasswords', 'Reject passwords found in known data breaches (HaveIBeenPwned)',
                  'Only the first 5 characters of the password hash are sent (k-anonymity); the password never leaves the server.')}
              </Card.Body>
            </Card>
            <Card className="saas-card mb-4">
              <Card.Header className="bg-transparent py-3"><h5 className="mb-0 saas-heading"><i className="bi bi-file-earmark-text me-2" aria-hidden="true"></i>Privacy (GDPR)</h5></Card.Header>
              <Card.Body>
                <Form.Group controlId="set-privacy">
                  <Form.Label className="fw-semibold">Current privacy policy version</Form.Label>
                  <Form.Control value={form.privacyPolicyVersion} maxLength={20} style={{ maxWidth: 160 }} pattern="[\w.\-]{1,20}" required
                    onChange={e => set('privacyPolicyVersion', e.target.value)} />
                  <Form.Text>Stored with each user's consent at sign-up. Letters, numbers, dots and dashes.</Form.Text>
                </Form.Group>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card className="saas-card mb-4">
          <Card.Body className="small" style={{ color: 'var(--text-secondary)' }}>
            <i className="bi bi-info-circle me-2" aria-hidden="true"></i>
            Secrets such as API keys (Google, Gemini, email) are kept in the server's <code>.env</code> file, not in the database or the browser.
            Their status is shown on the Security overview.
          </Card.Body>
        </Card>

        <div className="d-flex gap-2">
          <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button variant="outline-secondary" disabled={!dirty} onClick={() => setForm(saved)}>Discard</Button>
          {defaults && <Button variant="link" onClick={() => setForm({ ...defaults })}>Load defaults</Button>}
        </div>
      </Form>
    </Container>
  );
}
