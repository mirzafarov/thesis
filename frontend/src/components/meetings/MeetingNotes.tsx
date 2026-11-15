// "Agenda & notes" dialog: the meeting agenda (participants confirm it) and shared notes for the minutes.
// The server stores agenda and notes encrypted and decides who may do what (sent along as canManage / canConfirm / canAddNotes).
import { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { AuthContext } from '../../context/AuthContext';
import { apiError } from '../../lib/apiError';

interface Person { id: string; firstName: string; lastName: string }
interface NotesData {
  agenda: string | null;
  agendaUpdatedAt: string | null;
  notesOpen: boolean;
  participants: number;
  confirmations: { user: Person; confirmedAt: string }[];
  confirmedByMe: boolean;
  notes: { id: string; author: Person | null; content: string; createdAt: string; updatedAt: string }[];
  canManage: boolean;
  canConfirm: boolean;
  canAddNotes: boolean;
}

const fullName = (p: Person | null) => (p ? `${p.firstName} ${p.lastName}` : 'Former member');

interface Props {
  meeting: { id: string; title: string } | null;
  onHide: () => void;
  /** Open the AI assistant with these notes as input for the minutes */
  onWriteMinutes: (notesText: string) => void;
}

export const MeetingNotesModal = ({ meeting, onHide, onWriteMinutes }: Props) => {
  const { user } = useContext(AuthContext);
  const [data, setData] = useState<NotesData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agendaDraft, setAgendaDraft] = useState<string | null>(null); // non-null while editing
  const [newNote, setNewNote] = useState('');

  const load = useCallback(async () => {
    if (!meeting) return;
    try {
      setData((await axios.get(`/api/meetings/${meeting.id}/notes`)).data);
    } catch (err) {
      setError(apiError(err, 'Could not load the agenda and notes.'));
    }
  }, [meeting]);

  useEffect(() => {
    setData(null); setError(''); setAgendaDraft(null); setNewNote('');
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(apiError(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const id = meeting?.id;
  const notesAsText = (data?.notes ?? []).map(n => `- ${fullName(n.author)}: ${n.content}`).join('\n');

  return (
    <Modal show={!!meeting} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0">
        <Modal.Title className="fw-bold">Agenda & notes: {meeting?.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <p className="small" style={{ color: 'var(--text-secondary)' }}>
          <i className="bi bi-lock me-1" aria-hidden="true"></i>The agenda and notes are stored encrypted and are visible to the meeting's participants and project managers.
        </p>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!data && !error && <div className="text-center py-4"><Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>}

        {data && (
          <>
            {/* ---------- Agenda ---------- */}
            <section aria-labelledby="agenda-title" className="mb-4">
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <h3 id="agenda-title" className="h6 fw-bold mb-0">Agenda</h3>
                {data.agenda && (
                  <Badge bg={data.confirmations.length === data.participants ? 'success' : 'secondary'}>
                    Confirmed by {data.confirmations.length} of {data.participants}
                  </Badge>
                )}
              </div>

              {agendaDraft !== null ? (
                <Form onSubmit={e => { e.preventDefault(); run(async () => { await axios.put(`/api/meetings/${id}/agenda`, { agenda: agendaDraft }); setAgendaDraft(null); }); }}>
                  <Form.Control as="textarea" rows={7} maxLength={10000} aria-label="Agenda" value={agendaDraft}
                    placeholder={'1. Welcome (5 min)\n2. Progress since last meeting (15 min)\n3. Next steps (10 min)'}
                    onChange={e => setAgendaDraft(e.target.value)} />
                  <div className="small mt-1 mb-2" style={{ color: 'var(--text-secondary)' }}>Saving asks every participant to confirm the agenda again.</div>
                  <div className="d-flex gap-2">
                    <Button type="submit" size="sm" disabled={busy}>Save agenda</Button>
                    <Button size="sm" variant="outline-secondary" onClick={() => setAgendaDraft(null)}>Cancel</Button>
                  </div>
                </Form>
              ) : data.agenda ? (
                <div className="p-3 rounded border" style={{ borderColor: 'var(--border)' }}>
                  <div className="markdown-body" style={{ fontSize: '0.95rem' }}><ReactMarkdown>{data.agenda}</ReactMarkdown></div>
                </div>
              ) : (
                <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>No agenda yet.{data.canManage ? ' Write one, or create it with the AI assistant ("Meeting Agenda") and choose "Use as agenda".' : ''}</p>
              )}

              {agendaDraft === null && (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {data.canConfirm && data.agenda && (
                    <Button size="sm" variant={data.confirmedByMe ? 'success' : 'outline-success'} aria-pressed={data.confirmedByMe} disabled={busy}
                      onClick={() => run(() => axios.post(`/api/meetings/${id}/agenda/confirm`, { confirmed: !data.confirmedByMe }))}>
                      <i className={`bi ${data.confirmedByMe ? 'bi-check-circle-fill' : 'bi-check-circle'} me-1`} aria-hidden="true"></i>
                      {data.confirmedByMe ? 'You confirmed the agenda' : 'Confirm agenda'}
                    </Button>
                  )}
                  {data.canManage && (
                    <Button size="sm" variant="outline-primary" onClick={() => setAgendaDraft(data.agenda ?? '')}>
                      <i className="bi bi-pencil me-1" aria-hidden="true"></i>{data.agenda ? 'Edit agenda' : 'Write agenda'}
                    </Button>
                  )}
                </div>
              )}
              {data.confirmations.length > 0 && (
                <div className="small mt-2" style={{ color: 'var(--text-secondary)' }}>
                  Confirmed by: {data.confirmations.map(c => fullName(c.user)).join(', ')}
                </div>
              )}
            </section>

            {/* ---------- Notes ---------- */}
            <section aria-labelledby="notes-title">
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <h3 id="notes-title" className="h6 fw-bold mb-0">Notes for the minutes</h3>
                {data.canManage && (
                  <Form.Check type="switch" id="notes-open" label="Participants may add notes" checked={data.notesOpen} disabled={busy}
                    onChange={e => run(() => axios.put(`/api/meetings/${id}/notes-settings`, { notesOpen: e.target.checked }))} />
                )}
              </div>

              {data.notes.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No notes yet.</p>
              ) : (
                <ListGroup className="mb-3">
                  {data.notes.map(n => {
                    const mine = n.author?.id === user?.id;
                    const canDelete = data.canManage || (mine && data.canAddNotes);
                    return (
                      <ListGroup.Item key={n.id} className="d-flex gap-2 align-items-start" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                          <div className="small fw-semibold">{fullName(n.author)}{mine ? ' (you)' : ''}
                            <span className="fw-normal ms-2" style={{ color: 'var(--text-secondary)' }}>{new Date(n.createdAt).toLocaleString()}</span>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.content}</div>
                        </div>
                        {canDelete && (
                          <Button variant="link" size="sm" className="text-danger p-1" aria-label="Delete this note" title="Delete" disabled={busy}
                            onClick={() => { if (window.confirm('Delete this note?')) run(() => axios.delete(`/api/meeting-notes/${n.id}`)); }}>
                            <i className="bi bi-trash" aria-hidden="true"></i>
                          </Button>
                        )}
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}

              {data.canAddNotes ? (
                <Form onSubmit={e => { e.preventDefault(); if (newNote.trim()) run(async () => { await axios.post(`/api/meetings/${id}/notes`, { content: newNote }); setNewNote(''); }); }}>
                  <Form.Control as="textarea" rows={2} maxLength={5000} aria-label="New note" placeholder="e.g. Budget approved; Aysel sends the figures by Friday"
                    value={newNote} onChange={e => setNewNote(e.target.value)} />
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <Button type="submit" size="sm" disabled={busy || !newNote.trim()}>Add note</Button>
                    {data.notes.length > 0 && (
                      <Button size="sm" variant="outline-primary" onClick={() => onWriteMinutes(notesAsText)}>
                        <i className="bi bi-magic me-1" aria-hidden="true"></i>Write the minutes with AI from these notes
                      </Button>
                    )}
                  </div>
                </Form>
              ) : (
                <p className="small mb-0" style={{ color: 'var(--text-secondary)' }}>
                  {data.notesOpen ? 'Observers can read the notes but not add them.' : 'The organizer has closed the notes for participants.'}
                </p>
              )}
            </section>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
};
