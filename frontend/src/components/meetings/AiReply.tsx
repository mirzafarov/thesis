// AI reply to a meeting invitation: the user chooses accept / decline, the language and an optional note,
// and Gemini drafts a short email to the organizer with the meeting's real details. Nothing is sent automatically.
import { useEffect, useState } from 'react';
import { Alert, Button, ButtonGroup, Form, Modal } from 'react-bootstrap';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

export const LANGUAGE_OPTIONS = [['en', 'English'], ['lt', 'Lietuvių (Lithuanian)']] as const;

/** Copies text and briefly says so on the button. */
export const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="outline-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
    }}>
      <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'} me-1`} aria-hidden="true"></i>{copied ? 'Copied' : 'Copy'}
    </Button>
  );
};

export const AiReplyModal = ({ meeting, onHide }: { meeting: { id: string; title: string } | null; onHide: () => void }) => {
  const [type, setType] = useState<'ACCEPT' | 'DECLINE'>('ACCEPT');
  const [language, setLanguage] = useState('en');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(''); setError(''); setNote(''); setType('ACCEPT'); }, [meeting]);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meeting) return;
    setBusy(true);
    setError('');
    setDraft('');
    try {
      const res = await axios.post(`/api/meetings/${meeting.id}/email-draft`, { responseType: type, language, note });
      setDraft(res.data.draft);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not write the reply.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={!!meeting} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className="border-0">
        <Modal.Title className="fw-bold"><i className="bi bi-reply text-primary me-2" aria-hidden="true"></i>Reply with AI: {meeting?.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <p className="small" style={{ color: 'var(--text-secondary)' }}>
          Gemini writes a short email to the organizer using the meeting's details. Check it, then copy it into your email. Your vote is separate.
        </p>
        <Form onSubmit={generate}>
          <div className="d-flex flex-wrap gap-3 mb-3 align-items-end">
            <div>
              <div className="small fw-semibold mb-1" id="reply-type-label">Answer</div>
              <ButtonGroup aria-labelledby="reply-type-label">
                <Button variant={type === 'ACCEPT' ? 'success' : 'outline-secondary'} aria-pressed={type === 'ACCEPT'} onClick={() => setType('ACCEPT')}>Accept</Button>
                <Button variant={type === 'DECLINE' ? 'danger' : 'outline-secondary'} aria-pressed={type === 'DECLINE'} onClick={() => setType('DECLINE')}>Decline</Button>
              </ButtonGroup>
            </div>
            <Form.Group controlId="reply-language">
              <Form.Label className="small fw-semibold mb-1">Language</Form.Label>
              <Form.Select value={language} onChange={e => setLanguage(e.target.value)}>
                {LANGUAGE_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Form.Select>
            </Form.Group>
          </div>
          <Form.Group className="mb-3" controlId="reply-note">
            <Form.Label className="small fw-semibold mb-1">Anything to add? (optional)</Form.Label>
            <Form.Control as="textarea" rows={2} maxLength={1000} placeholder="e.g. I can only stay for the first 30 minutes" value={note} onChange={e => setNote(e.target.value)} />
          </Form.Group>
          <div className="text-end">
            <Button type="submit" disabled={busy} className="rounded-pill px-4">
              {busy ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Writing…</> : <><i className="bi bi-stars me-1" aria-hidden="true"></i>Write reply</>}
            </Button>
          </div>
        </Form>
        {error && <Alert variant="danger" className="mt-3 py-2">{error}</Alert>}
        {draft && (
          <div className="mt-4 p-3 rounded border" style={{ borderColor: 'var(--border)' }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h3 className="h6 fw-bold mb-0 text-primary">Draft reply</h3>
              <CopyButton text={draft} />
            </div>
            <div className="markdown-body" style={{ fontSize: '0.95rem' }}><ReactMarkdown>{draft}</ReactMarkdown></div>
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
};
