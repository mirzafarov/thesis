// Project email groups: managers create groups of project members; members write a message once and Safe Zone
// emails it to everyone in the group and keeps it (encrypted) in the group history.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';
import axios from 'axios';

interface Member { userId: string; role: string; user: { firstName: string; lastName: string } }
interface Group {
  id: string; name: string; alias: string; isMember: boolean; messages: number;
  members: { id: string; firstName: string; lastName: string }[];
}
interface Message { id: string; sender: { id: string; firstName: string; lastName: string } | null; subject: string; body: string; recipients: number; createdAt: string }

/** Create or edit a group: name and members. */
const GroupForm = ({ projectId, members, group, onDone, onCancel }: {
  projectId: string; members: Member[]; group: Group | null; onDone: () => void; onCancel: () => void;
}) => {
  const [name, setName] = useState(group?.name ?? '');
  const [chosen, setChosen] = useState<string[]>(group?.members.map(m => m.id) ?? members.map(m => m.userId));
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (group) await axios.put(`/api/groups/${group.id}`, { name, memberIds: chosen });
      else await axios.post(`/api/projects/${projectId}/groups`, { name, memberIds: chosen });
      onDone();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save the group.');
    }
  };
  return (
    <Form onSubmit={save} className="border rounded p-3 mb-3" style={{ borderColor: 'var(--border)' }}>
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      <Form.Group className="mb-2" controlId="group-name">
        <Form.Label className="small fw-semibold mb-1">Group name</Form.Label>
        <Form.Control required maxLength={80} placeholder="e.g. Steering committee" value={name} onChange={e => setName(e.target.value)} />
      </Form.Group>
      <fieldset className="mb-2">
        <legend className="small fw-semibold mb-1" style={{ fontSize: '0.875rem' }}>Members</legend>
        <div className="d-flex flex-wrap gap-3">
          {members.map(m => (
            <Form.Check key={m.userId} id={`gm-${m.userId}`} type="checkbox" label={`${m.user.firstName} ${m.user.lastName}`}
              checked={chosen.includes(m.userId)}
              onChange={() => setChosen(c => (c.includes(m.userId) ? c.filter(x => x !== m.userId) : [...c, m.userId]))} />
          ))}
        </div>
      </fieldset>
      <div className="d-flex gap-2">
        <Button type="submit" size="sm" disabled={!name.trim() || chosen.length === 0}>{group ? 'Save' : 'Create group'}</Button>
        <Button size="sm" variant="outline-secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Form>
  );
};

/** One group's history and the "write to everyone" form. */
const GroupMessagesModal = ({ group, onHide }: { group: Group | null; onHide: () => void }) => {
  const [data, setData] = useState<{ canSend: boolean; messages: Message[] } | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!group) return;
    try { setData((await axios.get(`/api/groups/${group.id}/messages`)).data); }
    catch (err: any) { setError(err.response?.data?.error || 'Could not load the messages.'); }
  }, [group]);
  useEffect(() => { setData(null); setError(''); setNotice(''); setSubject(''); setBody(''); load(); }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await axios.post(`/api/groups/${group!.id}/messages`, { subject, body });
      setNotice(`Sent to ${res.data.recipients} member${res.data.recipients === 1 ? '' : 's'} by email and saved in the history.`);
      setSubject(''); setBody('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={!!group} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0">
        <Modal.Title className="fw-bold">
          {group?.name}
          <div className="small fw-normal" style={{ color: 'var(--text-secondary)' }}>{group?.alias} · {group?.members.length} member{group?.members.length === 1 ? '' : 's'}</div>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2" role="status">{notice}</Alert>}
        {data?.canSend && (
          <Form onSubmit={send} className="mb-4">
            <h3 className="h6 fw-bold">Write to everyone in the group</h3>
            <Form.Control className="mb-2" placeholder="Subject" aria-label="Subject" maxLength={200} required value={subject} onChange={e => setSubject(e.target.value)} />
            <Form.Control as="textarea" rows={4} placeholder="Message" aria-label="Message" maxLength={10000} required value={body} onChange={e => setBody(e.target.value)} />
            <div className="d-flex justify-content-between align-items-center mt-2">
              <span className="small" style={{ color: 'var(--text-secondary)' }}><i className="bi bi-lock me-1" aria-hidden="true"></i>Stored encrypted in the history</span>
              <Button type="submit" disabled={busy || !subject.trim() || !body.trim()}>{busy ? 'Sending…' : <><i className="bi bi-send me-1" aria-hidden="true"></i>Send</>}</Button>
            </div>
          </Form>
        )}
        <h3 className="h6 fw-bold">History</h3>
        {!data && !error && <div className="text-center py-3"><Spinner size="sm" animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>}
        {data && data.messages.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No messages yet.</p>}
        {data && data.messages.length > 0 && (
          <ListGroup>
            {data.messages.map(m => (
              <ListGroup.Item key={m.id} style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                <div className="d-flex flex-wrap justify-content-between gap-2">
                  <strong style={{ overflowWrap: 'anywhere' }}>{m.subject}</strong>
                  <span className="small" style={{ color: 'var(--text-secondary)' }}>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="small mb-1" style={{ color: 'var(--text-secondary)' }}>
                  From {m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'a former member'} · emailed to {m.recipients}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default function ProjectGroups({ projectId, members }: { projectId: string; members: Member[] }) {
  const [data, setData] = useState<{ groups: Group[]; canManage: boolean } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [openGroup, setOpenGroup] = useState<Group | null>(null);

  const load = useCallback(async () => {
    try { setData((await axios.get(`/api/projects/${projectId}/groups`)).data); }
    catch (err: any) { setError(err.response?.data?.error || 'Could not load the groups.'); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (g: Group) => {
    if (!window.confirm(`Delete the group "${g.name}" and its message history?`)) return;
    try { await axios.delete(`/api/groups/${g.id}`); load(); }
    catch (err: any) { setError(err.response?.data?.error || 'Could not delete the group.'); }
  };

  // Members without groups and not managers see nothing here
  if (data && !data.canManage && data.groups.length === 0) return null;

  return (
    <Card className="saas-card mt-4">
      <Card.Header className="bg-transparent py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div>
          <h5 className="mb-0 saas-heading"><i className="bi bi-envelope-paper me-2" aria-hidden="true"></i>Email groups</h5>
          <div className="small mt-1" style={{ color: 'var(--text-secondary)' }}>Write once, and everyone in the group gets it by email. Messages are kept in the group history.</div>
        </div>
        {data?.canManage && editing === null && (
          <Button size="sm" variant="outline-primary" onClick={() => setEditing('new')}><i className="bi bi-plus-lg me-1" aria-hidden="true"></i>New group</Button>
        )}
      </Card.Header>
      <Card.Body>
        {error && <Alert variant="danger" className="py-2" dismissible onClose={() => setError('')}>{error}</Alert>}
        {editing !== null && (
          <GroupForm projectId={projectId} members={members} group={editing === 'new' ? null : editing}
            onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
        )}
        {!data && !error && <Spinner size="sm" animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner>}
        {data && data.groups.length === 0 && editing === null && (
          <p className="mb-0" style={{ color: 'var(--text-secondary)' }}>No groups yet. Create one, e.g. "All partners" or "Steering committee".</p>
        )}
        {data && data.groups.length > 0 && (
          <ListGroup>
            {data.groups.map(g => (
              <ListGroup.Item key={g.id} className="d-flex flex-wrap justify-content-between align-items-center gap-2"
                style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="fw-semibold">{g.name} {g.messages > 0 && <Badge bg="secondary" className="ms-1">{g.messages} message{g.messages === 1 ? '' : 's'}</Badge>}</div>
                  <div className="small" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                    {g.alias} · {g.members.map(m => `${m.firstName} ${m.lastName}`).join(', ')}
                  </div>
                </div>
                <div className="d-flex gap-2">
                  <Button size="sm" onClick={() => setOpenGroup(g)}><i className="bi bi-chat-text me-1" aria-hidden="true"></i>Open</Button>
                  {data.canManage && (
                    <>
                      <Button size="sm" variant="outline-secondary" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}><i className="bi bi-pencil" aria-hidden="true"></i></Button>
                      <Button size="sm" variant="outline-danger" onClick={() => remove(g)} aria-label={`Delete ${g.name}`}><i className="bi bi-trash" aria-hidden="true"></i></Button>
                    </>
                  )}
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Card.Body>
      <GroupMessagesModal group={openGroup} onHide={() => { setOpenGroup(null); load(); }} />
    </Card>
  );
}
