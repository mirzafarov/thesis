// Asks logged-in users to accept the privacy policy again when its version changed (or if they never gave a recorded
// consent). The time and version are stored on the server, as at registration. The user can also log out instead.
import { useContext, useEffect, useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { apiError } from '../lib/apiError';

/** Fired after consent was saved, so the first-login tour can start. */
export const POLICY_ACCEPTED_EVENT = 'safezone:policy-accepted';

export default function PolicyConsent() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [version, setVersion] = useState<string | null>(null); // version waiting for acceptance
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    axios.get('/api/auth/me')
      .then(r => { if (!cancelled && r.data.consentVersion !== r.data.currentPolicyVersion) setVersion(r.data.currentPolicyVersion); })
      .catch(() => { /* the page shows its own errors */ });
    return () => { cancelled = true; };
  }, [user]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await axios.post('/api/auth/me/consent', { version });
      setVersion(null);
      window.dispatchEvent(new Event(POLICY_ACCEPTED_EVENT));
    } catch (err) {
      setError(apiError(err, 'Could not save your consent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={!!version} backdrop="static" keyboard={false} centered aria-labelledby="policy-title">
      <Modal.Header className="border-0 pb-0">
        <Modal.Title id="policy-title" className="fw-bold"><i className="bi bi-shield-check text-primary me-2" aria-hidden="true"></i>Privacy policy updated</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>Our privacy policy is now at <strong>version {version}</strong>. Please read it and accept it to continue using Safe Zone.</p>
        <p className="mb-0">
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Read the privacy policy <i className="bi bi-box-arrow-up-right ms-1" aria-hidden="true"></i><span className="visually-hidden">(opens in a new tab)</span></a>
          {' · '}
          <a href="/cookies" target="_blank" rel="noopener noreferrer">Cookie policy<span className="visually-hidden"> (opens in a new tab)</span></a>
        </p>
        {error && <Alert variant="danger" className="mt-3 mb-0 py-2">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer className="border-0">
        <Button variant="outline-secondary" onClick={() => { logout(); navigate('/home'); }}>Log out</Button>
        <Button onClick={accept} disabled={busy}>{busy ? 'Saving…' : 'I accept'}</Button>
      </Modal.Footer>
    </Modal>
  );
}
