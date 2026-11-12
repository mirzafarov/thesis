// System audit log for administrators: search, filters, paging and CSV export.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Container, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { ActionBadge, formatIp, tdStyle, thStyle, when } from './admin/adminUi';

interface LogRow {
  id: string;
  action: string;
  details: string | null;
  ipAddress: string | null;
  projectId: string | null;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string } | null;
}

const GROUP_LABEL: Record<string, string> = {
  security: 'Security incidents', logins: 'Logins & logouts', accounts: 'Accounts', projects: 'Projects & plans',
  meetings: 'Meetings', reports: 'Reports & exports', admin: 'Administrator actions',
};

const AdminLogs = () => {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({
    q: params.get('q') ?? '', group: params.get('group') ?? '', ip: params.get('ip') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '',
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: LogRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/admin/logs', { params: { ...query(), page, pageSize: 50 } });
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load the logs.');
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => { load(); }, [load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setParams(query());
    load();
  };

  const exportCsv = async () => {
    try {
      const res = await axios.get('/api/admin/logs/export', { params: query(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `safezone-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not export the logs.');
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Container fluid className="p-2 p-md-4">
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
        <h2 className="mb-0 saas-heading fw-bold">System audit logs</h2>
        <Button variant="outline-success" onClick={exportCsv}><i className="bi bi-filetype-csv me-1" aria-hidden="true"></i>Export CSV</Button>
      </div>

      <Card className="saas-card mb-3">
        <Card.Body>
          <Form onSubmit={apply}>
            <Row className="g-2 align-items-end">
              <Col md={3}>
                <Form.Label className="small text-uppercase fw-semibold" htmlFor="log-q">Search</Form.Label>
                <Form.Control id="log-q" placeholder="Email, action or text…" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} />
              </Col>
              <Col md={2}>
                <Form.Label className="small text-uppercase fw-semibold" htmlFor="log-group">Type</Form.Label>
                <Form.Select id="log-group" value={filters.group} onChange={e => setFilters({ ...filters, group: e.target.value })}>
                  <option value="">All events</option>
                  {Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small text-uppercase fw-semibold" htmlFor="log-ip">IP address</Form.Label>
                <Form.Control id="log-ip" value={filters.ip} onChange={e => setFilters({ ...filters, ip: e.target.value })} />
              </Col>
              <Col xs={6} md={2}>
                <Form.Label className="small text-uppercase fw-semibold" htmlFor="log-from">From</Form.Label>
                <Form.Control id="log-from" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
              </Col>
              <Col xs={6} md={2}>
                <Form.Label className="small text-uppercase fw-semibold" htmlFor="log-to">To</Form.Label>
                <Form.Control id="log-to" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
              </Col>
              <Col md={1} className="d-grid">
                <Button type="submit">Filter</Button>
              </Col>
            </Row>
          </Form>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="saas-card overflow-hidden border-0">
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
            <thead>
              <tr>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>IP address</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={5} className="text-center py-5"><Spinner animation="border" size="sm" /></td></tr>}
              {data?.items.map(log => (
                <tr key={log.id}>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)' }} className="small text-nowrap">{when(log.createdAt)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)' }} className="small">
                    {log.user ? <><span className="fw-semibold">{log.user.firstName} {log.user.lastName}</span><br /><span style={{ color: 'var(--text-secondary)' }}>{log.user.email}</span></> : 'System'}
                  </td>
                  <td style={tdStyle}><ActionBadge action={log.action} /></td>
                  <td style={tdStyle} className="text-nowrap">
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatIp(log.ipAddress)}</span>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-primary)' }} className="small">{log.details}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr><td colSpan={5} className="text-center py-5" style={{ color: 'var(--text-secondary)' }}>No log entries match these filters.</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {data && (
        <div className="d-flex justify-content-between align-items-center mt-3 small" style={{ color: 'var(--text-secondary)' }}>
          <span>{data.total.toLocaleString()} entries · page {page} of {pages}</span>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Newer</Button>
            <Button size="sm" variant="outline-secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Older →</Button>
          </div>
        </div>
      )}
    </Container>
  );
};

export default AdminLogs;
