// Video calls: the choice in the schedule form, the Join button on a meeting, and the organizer's settings dialog.
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import axios from 'axios';

export type VideoMode = 'auto' | 'jitsi' | 'custom' | 'none';

const PROVIDER: Record<string, string> = { auto: 'Video call', jitsi: 'Jitsi Meet', google_meet: 'Google Meet', custom: 'Online meeting' };
export const providerName = (p: string | null | undefined) => (p ? PROVIDER[p] ?? 'Video call' : 'In person');

const OPTION_TEXT: Record<VideoMode, string> = {
  auto: 'Online: Google Meet if I have connected Google Calendar, otherwise Jitsi',
  jitsi: 'Online: Jitsi Meet (works without any account)',
  custom: 'Online: my own link (Zoom, Teams, ...)',
  none: 'In person (no video call)',
};

/** The radio list and, for "custom", the link field. */
export const VideoChoice = ({ mode, url, onChange, allowAuto = true, idPrefix }: {
  mode: VideoMode; url: string; onChange: (mode: VideoMode, url: string) => void; allowAuto?: boolean; idPrefix: string;
}) => (
  <fieldset>
    <legend className="fw-semibold text-muted small text-uppercase mb-2" style={{ fontSize: '0.875rem' }}>Video call</legend>
    {(Object.keys(OPTION_TEXT) as VideoMode[]).filter(m => allowAuto || m !== 'auto').map(m => (
      <Form.Check key={m} type="radio" id={`${idPrefix}-${m}`} name={`${idPrefix}-video`} label={OPTION_TEXT[m]}
        checked={mode === m} onChange={() => onChange(m, url)} />
    ))}
    {mode === 'custom' && (
      <Form.Control className="mt-2" type="url" required placeholder="https://..." aria-label="Meeting link" maxLength={500}
        value={url} onChange={e => onChange('custom', e.target.value)} />
    )}
  </fieldset>
);

/** From 15 minutes before the start until the end the button says "Join now" and stands out. */
const isLive = (m: any, now: number) =>
  m.startDate && now >= new Date(m.startDate).getTime() - 15 * 60000 && now <= new Date(m.endDate ?? m.startDate).getTime();

export const JoinButton = ({ meeting }: { meeting: any }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  if (!meeting.videoUrl || ['COMPLETED', 'CANCELLED', 'DRAFT'].includes(meeting.status)) return null;
  const live = isLive(meeting, now);
  return (
    <Button as="a" href={meeting.videoUrl} target="_blank" rel="noopener noreferrer" size="sm" variant={live ? 'success' : 'outline-success'}
      aria-label={`${live ? 'Join now' : 'Join'}: ${providerName(meeting.videoProvider)} (opens in a new tab)`}>
      <i className="bi bi-camera-video me-1" aria-hidden="true"></i>{live ? 'Join now' : 'Join call'}
    </Button>
  );
};

/** Organizer / project manager: switch between Jitsi, a custom link and in person. */
export const VideoSettingsModal = ({ meeting, onHide, onSaved }: { meeting: any | null; onHide: () => void; onSaved: () => void }) => {
  const [mode, setMode] = useState<VideoMode>('jitsi');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meeting) return;
    const p = meeting.videoProvider;
    setMode(!p ? 'none' : p === 'custom' ? 'custom' : p === 'auto' ? 'auto' : 'jitsi');
    setUrl(p === 'custom' ? meeting.videoUrl : '');
    setError('');
  }, [meeting]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.put(`/api/meetings/${meeting.id}/video`, { video: mode, videoUrl: mode === 'custom' ? url : undefined });
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not change the video call.');
    } finally {
      setBusy(false);
    }
  };

  const isMeet = meeting?.videoProvider === 'google_meet';
  return (
    <Modal show={!!meeting} onHide={onHide} centered>
      <Form onSubmit={save}>
        <Modal.Header closeButton className="border-0"><Modal.Title className="fw-bold">Video call</Modal.Title></Modal.Header>
        <Modal.Body>
          {meeting?.videoUrl && (
            <p className="small" style={{ color: 'var(--text-secondary)' }}>
              Now: <strong>{providerName(meeting.videoProvider)}</strong>, <span style={{ wordBreak: 'break-all' }}>{meeting.videoUrl}</span>
            </p>
          )}
          {isMeet && <Alert variant="info" className="small py-2">Choosing another option replaces the Google Meet link. Participants see the new link here and in their reminders.</Alert>}
          {error && <Alert variant="danger" className="py-2">{error}</Alert>}
          <VideoChoice idPrefix="edit" mode={mode} url={url} allowAuto={meeting?.status === 'DRAFT'} onChange={(m, u) => { setMode(m); setUrl(u); }} />
        </Modal.Body>
        <Modal.Footer className="border-0">
          <Button variant="secondary" onClick={onHide}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};
