import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import axios from 'axios';

/** Recovery codes shown once, with copy and download buttons. */
export const RecoveryCodes = ({ codes, onDone }: { codes: string[]; onDone: () => void }) => {
  const [saved, setSaved] = useState(false);
  const text = `Safe Zone recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'safe-zone-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Alert variant="warning">
        <strong>Save these recovery codes now.</strong> If you lose your phone, each code lets you log in once.
        They are shown only this time.
      </Alert>
      <div className="d-grid gap-1 mb-3 p-3 rounded border" style={{ gridTemplateColumns: 'repeat(2, 1fr)', fontFamily: 'monospace', fontSize: '1.05rem' }}>
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <Button variant="outline-secondary" size="sm" onClick={() => navigator.clipboard?.writeText(text)}>
          <i className="bi bi-clipboard me-1" aria-hidden="true"></i>Copy
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={download}>
          <i className="bi bi-download me-1" aria-hidden="true"></i>Download .txt
        </Button>
      </div>
      <Form.Check id="codes-saved" className="mb-3" label="I saved my recovery codes somewhere safe" checked={saved} onChange={e => setSaved(e.target.checked)} />
      <Button disabled={!saved} onClick={onDone}>Done</Button>
    </div>
  );
};

/** Scan QR code -> confirm first code -> show recovery codes. */
const TwoFactorSetup = ({ onEnabled }: { onEnabled: () => void }) => {
  const [qr, setQr] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development: create the secret only once.
    if (started.current) return;
    started.current = true;
    axios.post('/api/auth/2fa/setup')
      .then(res => setQr(res.data))
      .catch(err => setError(err.response?.data?.error || 'Could not start the setup.'));
  }, []);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await axios.post('/api/auth/2fa/enable', { code });
      setRecoveryCodes(res.data.recoveryCodes);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not enable two-factor login.');
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} onDone={onEnabled} />;

  return (
    <div>
      {error && <Alert variant="danger">{error}</Alert>}
      <ol className="ps-3">
        <li className="mb-2">
          Install an authenticator app on your phone: <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> or <strong>Authy</strong>.
        </li>
        <li className="mb-2">
          In the app, tap <strong>+</strong> and scan this QR code:
          <div className="my-3 text-center">
            {qr ? (
              <img src={qr.qrDataUrl} alt="QR code to add Safe Zone to your authenticator app" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
            ) : (
              !error && <Spinner animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner>
            )}
          </div>
          {qr && (
            <details className="small text-muted">
              <summary>Can't scan it? Enter this key instead</summary>
              <code className="d-block mt-1" style={{ wordBreak: 'break-all', fontSize: '0.95rem' }}>{qr.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </details>
          )}
        </li>
        <li>Enter the 6-digit code the app shows for <strong>Safe Zone</strong>:</li>
      </ol>
      <Form onSubmit={confirm} className="d-flex gap-2 align-items-start">
        <Form.Control
          aria-label="6-digit code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ maxWidth: 160, letterSpacing: '0.3em', fontSize: '1.15rem', textAlign: 'center' }}
        />
        <Button type="submit" disabled={busy || code.length !== 6 || !qr}>{busy ? 'Checking…' : 'Turn on'}</Button>
      </Form>
    </div>
  );
};

export default TwoFactorSetup;
