// Meeting to-do lists ("action items"): the dialog on the Meetings page and small shared helpers.
// The server decides who may do what; it sends canAdd / canManageAll with the list so the buttons match.
import { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';

export interface ActionItem {
  id: string;
  title: string;
  dueDate: string | null;
  doneAt: string | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

/** Due dates are calendar days stored as midnight UTC: show them without shifting to the local zone. */
export const formatDue = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (item: { dueDate: string | null; doneAt: string | null }) =>
  !item.doneAt && !!item.dueDate && item.dueDate.slice(0, 10) < todayKey();

/** "Due Fri 20 Nov", shown in red with the word "overdue" (not colour alone) when the day has passed. */
export const DueLabel = ({ item }: { item: { dueDate: string | null; doneAt: string | null } }) => {
  if (!item.dueDate) return null;
  const late = isOverdue(item);
  return (
    <span className={late ? 'text-danger fw-semibold' : undefined}>
      <i className="bi bi-calendar-event me-1" aria-hidden="true"></i>
      {late ? 'Overdue: ' : 'Due '}{formatDue(item.dueDate)}
    </span>
  );
};

interface Props {
  meeting: { id: string; title: string; participants: { user: { id: string; firstName: string; lastName: string } }[] } | null;
  onHide: () => void;
  onChanged: () => void; // refresh counts on the Meetings page
}

export const ActionItemsModal = ({ meeting, onHide, onChanged }: Props) => {
  const { user } = useContext(AuthContext);
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const [rights, setRights] = useState({ canAdd: false, canManageAll: false });
  const [form, setForm] = useState({ title: '', assigneeId: '', dueDate: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!meeting) return;
    try {
      const res = await axios.get(`/api/meetings/${meeting.id}/action-items`);
      setItems(res.data.items);
      setRights({ canAdd: res.data.canAdd, canManageAll: res.data.canManageAll });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load the to-do list.');
    }
  }, [meeting]);

  useEffect(() => {
    setItems(null);
    setError('');
    setForm({ title: '', assigneeId: '', dueDate: '' });
    load();
  }, [load]);

  const canEdit = (i: ActionItem) => rights.canAdd && (i.createdBy?.id === user?.id || rights.canManageAll);
  const canTick = (i: ActionItem) => canEdit(i) || (rights.canAdd && i.assignee?.id === user?.id);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.response?.data?.error || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    run(async () => {
      await axios.post(`/api/meetings/${meeting!.id}/action-items`, {
        title: form.title, assigneeId: form.assigneeId || null, dueDate: form.dueDate || null,
      });
      setForm({ title: '', assigneeId: '', dueDate: '' });
    });
  };

  const done = items?.filter(i => i.doneAt).length ?? 0;

  return (
    <Modal show={!!meeting} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className="border-0">
        <Modal.Title className="fw-bold">To-dos: {meeting?.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <p className="small mb-3" style={{ color: 'var(--text-secondary)' }}>
          What was agreed in this meeting. The person responsible gets an email when a to-do is assigned and a reminder the day before it is due.
        </p>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}

        {items === null && !error && <div className="text-center py-4"><Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>}

        {items && items.length === 0 && (
          <p className="text-center py-3 mb-3" style={{ color: 'var(--text-secondary)' }}>No to-dos yet.</p>
        )}

        {items && items.length > 0 && (
          <>
            <div className="small fw-semibold mb-2" style={{ color: 'var(--text-secondary)' }} aria-live="polite">{done} of {items.length} done</div>
            <ListGroup className="mb-3">
              {items.map(i => (
                <ListGroup.Item key={i.id} className="d-flex align-items-start gap-3" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                  <Form.Check
                    type="checkbox" id={`todo-${i.id}`} className="mt-1" checked={!!i.doneAt} disabled={busy || !canTick(i)}
                    aria-label={`Mark "${i.title}" as ${i.doneAt ? 'not done' : 'done'}`}
                    onChange={() => run(() => axios.patch(`/api/action-items/${i.id}`, { done: !i.doneAt }))}
                  />
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <label htmlFor={`todo-${i.id}`} className={`fw-semibold d-block ${i.doneAt ? 'text-decoration-line-through' : ''}`} style={{ overflowWrap: 'anywhere', color: i.doneAt ? 'var(--text-secondary)' : undefined }}>
                      {i.title}
                    </label>
                    <div className="small d-flex flex-wrap gap-3" style={{ color: 'var(--text-secondary)' }}>
                      <span><i className="bi bi-person me-1" aria-hidden="true"></i>{i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}` : 'Nobody assigned'}</span>
                      <DueLabel item={i} />
                      {i.doneAt && <Badge bg="success">Done</Badge>}
                    </div>
                  </div>
                  {canEdit(i) && (
                    <Button variant="link" size="sm" className="text-danger p-1" disabled={busy}
                      aria-label={`Delete "${i.title}"`} title="Delete"
                      onClick={() => { if (window.confirm(`Delete the to-do "${i.title}"?`)) run(() => axios.delete(`/api/action-items/${i.id}`)); }}>
                      <i className="bi bi-trash" aria-hidden="true"></i>
                    </Button>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </>
        )}

        {rights.canAdd ? (
          <Form onSubmit={add} className="border-top pt-3" style={{ borderColor: 'var(--border)' }}>
            <h3 className="h6 fw-bold mb-2">Add a to-do</h3>
            <Form.Group className="mb-2" controlId="todo-title">
              <Form.Label className="small fw-semibold mb-1">What needs to be done</Form.Label>
              <Form.Control value={form.title} maxLength={300} required placeholder="e.g. Send the updated budget to the client"
                onChange={e => setForm({ ...form, title: e.target.value })} />
            </Form.Group>
            <div className="d-flex flex-wrap gap-2 align-items-end">
              <Form.Group controlId="todo-assignee" style={{ flex: '1 1 200px' }}>
                <Form.Label className="small fw-semibold mb-1">Responsible</Form.Label>
                <Form.Select value={form.assigneeId} onChange={e => setForm({ ...form, assigneeId: e.target.value })}>
                  <option value="">Nobody yet</option>
                  {meeting?.participants.map(p => (
                    <option key={p.user.id} value={p.user.id}>{p.user.firstName} {p.user.lastName}{p.user.id === user?.id ? ' (me)' : ''}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group controlId="todo-due" style={{ flex: '0 1 180px' }}>
                <Form.Label className="small fw-semibold mb-1">Due date</Form.Label>
                <Form.Control type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
              </Form.Group>
              <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Add'}</Button>
            </div>
          </Form>
        ) : items && (
          <p className="small mb-0" style={{ color: 'var(--text-secondary)' }}>You can view this list. Observers cannot add or change to-dos.</p>
        )}
      </Modal.Body>
    </Modal>
  );
};
