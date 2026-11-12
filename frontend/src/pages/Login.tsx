import { useState, useContext } from 'react';
import { Form, Button, Card, Alert } from 'react-bootstrap';
import AuthShell from '../components/auth/AuthShell';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext, takeLogoutReason } from '../context/AuthContext';
import { browserTimeZone } from '../lib/time';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(() => takeLogoutReason());
  const [needsVerification, setNeedsVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const finish = (data: any) => {
    login(data.token, data.user);
    if (data.recoveryCodesLeft !== null && data.recoveryCodesLeft !== undefined && data.recoveryCodesLeft <= 3) {
      alert(`You have ${data.recoveryCodesLeft} recovery codes left. Create new ones in Settings.`);
    }
    navigate(data.user.mfaSetupRequired ? '/setup-2fa' : '/dashboard');
  };

  // Step 1: email and password
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setNeedsVerification(false);
    setBusy(true);
    try {
      // The browser's time zone is saved on first login (used to show and plan meeting times).
      const { data } = await axios.post('/api/auth/login', { email, password, timeZone: browserTimeZone() });
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setCode('');
      } else {
        finish(data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
      setNeedsVerification(err.response?.data?.code === 'EMAIL_NOT_VERIFIED');
    } finally {
      setBusy(false);
    }
  };

  // Step 2: code from the authenticator app (or a recovery code)
  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/auth/login/2fa', { mfaToken, code });
      finish(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
      if (err.response?.data?.code === 'MFA_EXPIRED') {
        setMfaToken('');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    try {
      const res = await axios.post('/api/auth/resend-verification', { email });
      setError('');
      setNeedsVerification(false);
      setInfo(res.data.message);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not send the email. Please try again later.');
    }
  };

  return (
    <AuthShell>
      <div className="w-100" style={{ maxWidth: '400px' }}>
        <Card>
          <Card.Body>
            <h2 className="text-center mb-4">{mfaToken ? 'Two-factor login' : 'Log In'}</h2>
            {error && (
              <Alert variant="danger">
                {error}
                {needsVerification && (
                  <div className="mt-2">
                    <Button variant="outline-danger" size="sm" onClick={resendVerification}>Send the confirmation email again</Button>
                  </div>
                )}
              </Alert>
            )}
            {info && <Alert variant="info">{info}</Alert>}

            {!mfaToken ? (
              <Form onSubmit={handlePassword}>
                <Form.Group controlId="email" className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Form.Group>
                <Form.Group controlId="password" className="mb-2">
                  <Form.Label>Password</Form.Label>
                  <Form.Control type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </Form.Group>
                <div className="text-end mb-4">
                  <Link to="/forgot-password" className="small">Forgot password?</Link>
                </div>
                <Button className="w-100" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Log In'}</Button>
              </Form>
            ) : (
              <Form onSubmit={handleCode}>
                <p className="text-muted small">
                  {useRecovery
                    ? 'Enter one of the recovery codes you saved when you set up two-factor login. Each code works once.'
                    : 'Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) and enter the 6-digit code for Safe Zone.'}
                </p>
                <Form.Group controlId="code" className="mb-3">
                  <Form.Label>{useRecovery ? 'Recovery code' : '6-digit code'}</Form.Label>
                  <Form.Control
                    autoFocus
                    required
                    autoComplete="one-time-code"
                    inputMode={useRecovery ? 'text' : 'numeric'}
                    placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
                    maxLength={useRecovery ? 11 : 6}
                    value={code}
                    onChange={e => setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
                    style={{ letterSpacing: '0.3em', fontSize: '1.25rem', textAlign: 'center' }}
                  />
                </Form.Group>
                <Button className="w-100 mb-3" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</Button>
                <div className="d-flex justify-content-between small">
                  <Button variant="link" size="sm" className="p-0" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}>
                    {useRecovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
                  </Button>
                  <Button variant="link" size="sm" className="p-0" onClick={() => { setMfaToken(''); setPassword(''); setError(''); }}>
                    Back
                  </Button>
                </div>
              </Form>
            )}
          </Card.Body>
        </Card>
        {!mfaToken && (
          <div className="w-100 text-center mt-2">
            Need an account? <Link to="/register">Sign Up</Link>
          </div>
        )}
      </div>
    </AuthShell>
  );
};

export default Login;
