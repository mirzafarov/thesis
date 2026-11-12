// Pages reached from emails: forgot password, reset password (link in email), confirm email (link in email).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Form, Button, Card, Alert, InputGroup, Spinner } from 'react-bootstrap';
import AuthShell from '../components/auth/AuthShell';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const AuthCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <AuthShell>
    <div className="w-100" style={{ maxWidth: '420px' }}>
      <Card>
        <Card.Body className="p-4">
          <h2 className="text-center mb-4">{title}</h2>
          {children}
        </Card.Body>
      </Card>
      <div className="w-100 text-center mt-2">
        <Link to="/login">Back to log in</Link>
      </div>
    </div>
  </AuthShell>
);

const errorOf = (err: any, fallback: string) => err?.response?.data?.error || fallback;

export const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await axios.post('/api/auth/forgot-password', { email });
      setMessage(res.data.message);
    } catch (err) {
      setError(errorOf(err, 'Could not send the email. Please try again later.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthCard title="Forgot password">
      {message ? (
        <Alert variant="success" className="mb-0">{message}</Alert>
      ) : (
        <Form onSubmit={submit}>
          <p className="text-muted">Enter the email address of your account. We will send you a link to choose a new password.</p>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group controlId="forgot-email" className="mb-4">
            <Form.Label>Email</Form.Label>
            <Form.Control type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
          </Form.Group>
          <Button className="w-100" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send reset link'}</Button>
        </Form>
      )}
    </AuthCard>
  );
};

export const ResetPassword = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      const res = await axios.post('/api/auth/reset-password', { token, password });
      setMessage(res.data.message);
    } catch (err) {
      setError(errorOf(err, 'Could not change the password. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Reset password">
        <Alert variant="danger">This link is incomplete. Please open the link from the email again, or <Link to="/forgot-password">request a new one</Link>.</Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {message ? (
        <Alert variant="success" className="mb-0">{message} <Link to="/login">Log in</Link></Alert>
      ) : (
        <Form onSubmit={submit}>
          {error && (
            <Alert variant="danger">
              {error}
              {error.includes('expired') && <> <Link to="/forgot-password">Request a new link</Link>.</>}
            </Alert>
          )}
          <p className="small text-muted">At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.</p>
          <Form.Group controlId="reset-password" className="mb-3">
            <Form.Label>New password</Form.Label>
            <InputGroup>
              <Form.Control type={show ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} />
              <Button variant="outline-secondary" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
                <i className={show ? 'bi bi-eye-slash' : 'bi bi-eye'} aria-hidden="true"></i>
              </Button>
            </InputGroup>
          </Form.Group>
          <Form.Group controlId="reset-confirm" className="mb-4">
            <Form.Label>Repeat new password</Form.Label>
            <Form.Control type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Form.Group>
          <Button className="w-100" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</Button>
        </Form>
      )}
    </AuthCard>
  );
};

export const VerifyEmail = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; message: string }>(
    token ? { status: 'loading', message: '' } : { status: 'error', message: 'This link is incomplete. Please open the link from the email again.' }
  );
  // React StrictMode runs effects twice in development; the token can only be used once.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    axios.post('/api/auth/verify-email', { token })
      .then(res => setState({ status: 'ok', message: res.data.message }))
      .catch(err => setState({ status: 'error', message: errorOf(err, 'Could not confirm the email address.') }));
  }, [token]);

  return (
    <AuthCard title="Confirm email">
      {state.status === 'loading' && <div className="text-center"><Spinner animation="border" role="status"><span className="visually-hidden">Confirming…</span></Spinner></div>}
      {state.status === 'ok' && <Alert variant="success" className="mb-0">{state.message} <Link to="/login">Log in</Link></Alert>}
      {state.status === 'error' && <Alert variant="danger" className="mb-0">{state.message}</Alert>}
    </AuthCard>
  );
};
