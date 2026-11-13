// Project log for project managers: everything recorded about one project (plan changes, meetings, to-dos,
// members, report exports), with search, filters and paging. Reuses the badge and table styles of the admin logs.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import axios from 'axios';
import { ActionBadge, tdStyle, thStyle, when } from '../pages/admin/adminUi';

interface LogRow {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string } | null;
}
interface Member { userId: string; user: { firstName: string; lastName: string } }

const GROUPS: [string, string][] = [['', 'All events'], ['projects', 'Plan & members'], ['meetings', 'Meetings & to-dos'], ['reports', 'Report exports']];

export default function ProjectLog({ projectId, members }: { projectId: string; members: Member[] }) {
  const [filters, setFilters] = useState({ q: '', group: '', userId: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: LogRow[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
      const res = await axios.get(`/api/projects/${projectId}/logs`, { params: { ...params, page } });
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load the project log.');
    } finally {
      setLoading(false);
    }
  }, [projectId, applied, page]);

  useEffect(() => { load(); }, [load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card className="saas-card mt-4">
      <Card.Header className="bg-transparent py-3">
        <h5 className="mb-0 saas-heading"><i className="bi bi-clock-history me-2" aria-hidden="true"></i>Project log</h5>
        <div className="small mt-1" style={{ color: 'var(--text-secondary)' }}>Visible to managers only: who changed the plan, scheduled meetings, handled to-dos or exported reports.</div>
      </Card.Header>
      <Card.Body>
        <Form onSubmit={apply} className="mb-3">
          <Row className="g-2 align-items-end">
            <Col md={3}>
              <Form.Label className="small fw-semibold mb-1" htmlFor="plog-q">Search</Form.Label>
              <Form.Control id="plog-q" size="sm" placeholder="Activity, meeting, text…" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small fw-semibold mb-1" htmlFor="plog-group">Type</Form.Label>
              <Form.Select id="plog-group" size="sm" value={filters.group} onChange={e => setFilters({ ...filters, group: e.target.value })}>
                {GROUPS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Form.Select>
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small fw-semibold mb-1" htmlFor="plog-user">Person</Form.Label>
              <Form.Select id="plog-user" size="sm" value={filters.userId} onChange={e => setFilters({ ...filters, userId: e.target.value })}>
                <option value="">Everyone</option>
                {members.map(m => <option key={m.userId} value={m.userId}>{m.user.firstName} {m.user.lastName}</option>)}
              </Form.Select>
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small fw-semibold mb-1" htmlFor="plog-from">From</Form.Label>
              <Form.Control id="plog-from" size="sm" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
            </Col>
            <Col xs={6} md={2}>
              <Form.Label className="small fw-semibold mb-1" htmlFor="plog-to">To</Form.Label>
              <Form.Control id="plog-to" size="sm" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
            </Col>
            <Col md={1} className="d-grid">
              <Button type="submit" size="sm">Filter</Button>
            </Col>
          </Row>
        </Form>

        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <Table responsive size="sm" className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
          <thead>
            <tr>
              <th style={thStyle}>When</th>
              <th style={thStyle}>Who</th>
              <th style={thStyle}>Event</th>
              <th style={thStyle}>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={4} className="text-center py-4"><Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading…</span></Spinner></td></tr>}
            {data?.items.map(l => (
              <tr key={l.id}>
                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }} className="small text-nowrap">{when(l.createdAt)}</td>
                <td style={{ ...tdStyle, color: 'var(--text-primary)' }} className="small text-nowrap">{l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System'}</td>
                <td style={tdStyle}><ActionBadge action={l.action} /></td>
                <td style={{ ...tdStyle, color: 'var(--text-primary)' }} className="small">{l.details}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={4} className="text-center py-4" style={{ color: 'var(--text-secondary)' }}>No entries match these filters.</td></tr>}
          </tbody>
        </Table>

        {data && data.total > data.pageSize && (
          <div className="d-flex justify-content-between align-items-center mt-3 small" style={{ color: 'var(--text-secondary)' }}>
            <span>{data.total} entries · page {page} of {pages}</span>
            <div className="d-flex gap-2">
              <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Newer</Button>
              <Button size="sm" variant="outline-secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Older →</Button>
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
