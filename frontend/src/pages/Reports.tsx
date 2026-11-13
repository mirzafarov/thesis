import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Row, Spinner, Table } from 'react-bootstrap';
import axios from 'axios';
import { CATEGORY_LABEL, exportPdf, exportXlsx, monthLabel } from '../lib/reportExport';
import type { ReportData } from '../lib/reportExport';

interface ProjectOption { id: string; name: string; startDate: string | null; endDate: string | null }
interface Person { id: string; firstName: string; lastName: string }

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function preset(name: 'week' | 'month' | 'lastMonth' | 'quarter'): [string, string] {
  const now = new Date();
  if (name === 'week') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return [key(monday), key(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6))];
  }
  if (name === 'month') return [key(new Date(now.getFullYear(), now.getMonth(), 1)), key(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (name === 'lastMonth') return [key(new Date(now.getFullYear(), now.getMonth() - 1, 1)), key(new Date(now.getFullYear(), now.getMonth(), 0))];
  return [key(new Date(now.getFullYear(), now.getMonth() - 2, 1)), key(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
}

const STATUS_BADGE: Record<string, string> = { COMPLETED: 'success', IN_PROGRESS: 'primary', PENDING: 'secondary', DELAYED: 'danger' };
const STATUS_TEXT: Record<string, string> = { COMPLETED: 'Completed', IN_PROGRESS: 'In progress', PENDING: 'Pending', DELAYED: 'Delayed' };

interface PhaseOption { id: string; name: string; projectId: string; projectName: string }

const Reports = () => {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [[from, to], setPeriod] = useState<[string, string]>(preset('month'));
  const [category, setCategory] = useState('ALL');
  const [people, setPeople] = useState<string[]>([]);
  const [phases, setPhases] = useState<string[]>([]);
  const [report, setReport] = useState<(ReportData & { availablePeople: Person[]; availablePhases: PhaseOption[] }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/projects').then(res => setProjects(res.data)).catch(() => setError('Could not load your projects.'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/reports', {
        params: { from, to, category, projectIds: selectedProjects.join(','), userIds: people.join(','), phaseIds: phases.join(',') },
      });
      setReport(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not build the report.');
    } finally {
      setLoading(false);
    }
  }, [from, to, category, selectedProjects, people, phases]);

  // Phases belong to projects: when the project selection changes, the phase selection starts over
  useEffect(() => { setPhases([]); }, [selectedProjects]);

  useEffect(() => { load(); }, [load]);

  const scopeLabel = useMemo(() => {
    if (selectedProjects.length === 0) return `All my projects (${projects.length})`;
    return projects.filter(p => selectedProjects.includes(p.id)).map(p => p.name).join(', ');
  }, [selectedProjects, projects]);

  // "Whole project": from the earliest start to the latest end of the chosen projects
  const wholeProject = () => {
    const chosen = projects.filter(p => selectedProjects.length === 0 || selectedProjects.includes(p.id));
    const starts = chosen.map(p => p.startDate).filter(Boolean) as string[];
    const ends = chosen.map(p => p.endDate).filter(Boolean) as string[];
    if (!starts.length || !ends.length) {
      setError('The selected project has no start and end dates. Set them with "Edit Project" first.');
      return;
    }
    setPeriod([starts.sort()[0]!.slice(0, 10), ends.sort().reverse()[0]!.slice(0, 10)]);
  };

  const doExport = async (format: 'PDF' | 'XLSX') => {
    if (!report) return;
    setExporting(format);
    try {
      if (format === 'PDF') await exportPdf(report, scopeLabel);
      else await exportXlsx(report, scopeLabel);
      axios.post('/api/reports/log', { format, projectIds: selectedProjects, from, to }).catch(() => {});
    } catch (err) {
      console.error(err);
      setError(`Could not create the ${format} file.`);
    } finally {
      setExporting('');
    }
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return (
    <Container fluid>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Reports</h2>
        <div className="d-flex gap-2">
          <Button variant="outline-danger" onClick={() => doExport('PDF')} disabled={!report || !!exporting}>
            {exporting === 'PDF' ? <Spinner size="sm" animation="border" /> : <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true"></i>} PDF
          </Button>
          <Button variant="outline-success" onClick={() => doExport('XLSX')} disabled={!report || !!exporting}>
            {exporting === 'XLSX' ? <Spinner size="sm" animation="border" /> : <i className="bi bi-file-earmark-excel me-1" aria-hidden="true"></i>} Excel (XLSX)
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4 shadow-sm border-0">
        <Card.Body>
          <Row className="g-3">
            <Col lg={4}>
              <Form.Label className="fw-semibold small text-uppercase text-muted">Projects</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                <Button size="sm" variant={selectedProjects.length === 0 ? 'primary' : 'outline-secondary'} onClick={() => setSelectedProjects([])}>All</Button>
                {projects.map(p => (
                  <Button key={p.id} size="sm" variant={selectedProjects.includes(p.id) ? 'primary' : 'outline-secondary'}
                    aria-pressed={selectedProjects.includes(p.id)} onClick={() => toggle(selectedProjects, setSelectedProjects, p.id)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </Col>
            <Col lg={5}>
              <Form.Label className="fw-semibold small text-uppercase text-muted">Period</Form.Label>
              {/* Wraps on narrow screens instead of widening the page */}
              <div className="d-flex flex-wrap gap-1 mb-2" role="group" aria-label="Quick periods">
                <Button size="sm" variant="outline-secondary" className="text-nowrap" onClick={() => setPeriod(preset('week'))}>This week</Button>
                <Button size="sm" variant="outline-secondary" className="text-nowrap" onClick={() => setPeriod(preset('month'))}>This month</Button>
                <Button size="sm" variant="outline-secondary" className="text-nowrap" onClick={() => setPeriod(preset('lastMonth'))}>Last month</Button>
                <Button size="sm" variant="outline-secondary" className="text-nowrap" onClick={() => setPeriod(preset('quarter'))}>3 months</Button>
                <Button size="sm" variant="outline-secondary" className="text-nowrap" onClick={wholeProject}>Whole project</Button>
              </div>
              <div className="d-flex gap-2 align-items-center">
                <Form.Control type="date" size="sm" aria-label="From" value={from} onChange={e => setPeriod([e.target.value, to])} />
                <span>–</span>
                <Form.Control type="date" size="sm" aria-label="To" min={from} value={to} onChange={e => setPeriod([from, e.target.value])} />
              </div>
            </Col>
            <Col lg={3}>
              <Form.Label className="fw-semibold small text-uppercase text-muted" htmlFor="rep-type">Meeting type</Form.Label>
              <Form.Select id="rep-type" size="sm" value={category} onChange={e => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Form.Select>
            </Col>
            {report && report.availablePhases.length > 0 && (
              <Col xs={12}>
                <Form.Label className="fw-semibold small text-uppercase text-muted">Project phases</Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  <Button size="sm" variant={phases.length === 0 ? 'primary' : 'outline-secondary'} onClick={() => setPhases([])}>All phases</Button>
                  {report.availablePhases.map(ph => (
                    <Button key={ph.id} size="sm" variant={phases.includes(ph.id) ? 'primary' : 'outline-secondary'}
                      aria-pressed={phases.includes(ph.id)} onClick={() => toggle(phases, setPhases, ph.id)}>
                      {ph.name}
                      {/* with several projects, say which project the phase belongs to */}
                      {new Set(report.availablePhases.map(x => x.projectId)).size > 1 && <span className="opacity-75"> · {ph.projectName}</span>}
                    </Button>
                  ))}
                </div>
                {phases.length > 0 && (
                  <div className="small mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Only meetings linked to an activity in these phases, and only those activities, are included.
                  </div>
                )}
              </Col>
            )}
            {report && report.availablePeople.length > 1 && (
              <Col xs={12}>
                <Form.Label className="fw-semibold small text-uppercase text-muted">People</Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  <Button size="sm" variant={people.length === 0 ? 'primary' : 'outline-secondary'} onClick={() => setPeople([])}>Everyone</Button>
                  {report.availablePeople.map(p => (
                    <Button key={p.id} size="sm" variant={people.includes(p.id) ? 'primary' : 'outline-secondary'}
                      aria-pressed={people.includes(p.id)} onClick={() => toggle(people, setPeople, p.id)}>
                      {p.firstName} {p.lastName}
                    </Button>
                  ))}
                </div>
              </Col>
            )}
          </Row>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {loading && !report && <div className="text-center p-5"><Spinner animation="border" role="status"><span className="visually-hidden">Loading…</span></Spinner></div>}

      {report && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {/* Totals */}
          <Row className="g-3 mb-4">
            {[
              ['Meetings', report.totals.meetings, 'bi-calendar-check'],
              ['Meeting hours', report.totals.meetingHours, 'bi-clock'],
              ['Person-hours in meetings', report.totals.personHours, 'bi-people'],
              ['Projects', report.totals.projects, 'bi-folder'],
            ].map(([label, value, icon]) => (
              <Col sm={6} lg={3} key={label as string}>
                <Card className="h-100 border-0 shadow-sm">
                  <Card.Body>
                    <div className="text-muted small"><i className={`bi ${icon} me-1`} aria-hidden="true"></i>{label}</div>
                    <div className="display-6 fw-semibold">{value}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {/* Projects */}
          <Card className="mb-4 shadow-sm border-0">
            <Card.Header className="bg-transparent fw-bold py-3">Projects</Card.Header>
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Project</th><th className="text-end">Meetings</th><th className="text-end">Meeting h</th><th className="text-end">Person-h</th><th className="text-end">With minutes</th><th className="text-end">Open polls</th><th>Activities</th></tr></thead>
              <tbody>
                {report.projects.map(p => (
                  <tr key={p.id}>
                    <td>{p.name} {!p.fullAccess && <Badge bg="light" text="dark" title="Only your own meetings are included">only you</Badge>}</td>
                    <td className="text-end">{p.meetings}</td>
                    <td className="text-end">{p.meetingHours}</td>
                    <td className="text-end">{p.personHours}</td>
                    <td className="text-end">{p.withMinutes}</td>
                    <td className="text-end">{p.openPolls}</td>
                    <td className="small">
                      {p.activities.total === 0 ? '—' : (
                        <>
                          {p.activities.completed}/{p.activities.total} done
                          {p.activities.delayed > 0 && <Badge bg="danger" className="ms-2">{p.activities.delayed} delayed</Badge>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* People */}
          <Card className="mb-4 shadow-sm border-0">
            <Card.Header className="bg-transparent fw-bold py-3">Time in meetings per person (hours)</Card.Header>
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Person</th><th className="text-end">Meetings</th>{report.months.map(m => <th key={m} className="text-end">{monthLabel(m)}</th>)}<th className="text-end">Total</th></tr></thead>
              <tbody>
                {report.people.length === 0 && <tr><td colSpan={report.months.length + 3} className="text-center text-muted py-4">No meetings in this period.</td></tr>}
                {report.people.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}<div className="small text-muted">{p.email}</div></td>
                    <td className="text-end">{p.meetings}</td>
                    {report.months.map(m => <td key={m} className="text-end">{p.byMonth[m] ?? 0}</td>)}
                    <td className="text-end fw-semibold">{p.hours}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Meetings */}
          <Card className="mb-4 shadow-sm border-0">
            <Card.Header className="bg-transparent fw-bold py-3">Meetings ({report.meetings.length})</Card.Header>
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Date</th><th>Meeting</th><th>Project</th><th>Type</th><th className="text-end">Min</th><th>Participants</th><th>Minutes</th></tr></thead>
              <tbody>
                {report.meetings.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">No meetings in this period.</td></tr>}
                {report.meetings.map(m => (
                  <tr key={m.id}>
                    <td className="text-nowrap small">{new Date(m.start).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{m.title}</td>
                    <td className="small">{m.project}</td>
                    <td><Badge bg="light" text="dark">{CATEGORY_LABEL[m.category] || m.category}</Badge></td>
                    <td className="text-end">{m.durationMin}</td>
                    <td className="small">{m.participants.join(', ')}</td>
                    <td className="small" style={{ maxWidth: 260 }}>
                      {m.minutes
                        ? <details><summary>Summary</summary><div style={{ whiteSpace: 'pre-wrap' }}>{m.minutes.replace(/[#*_`>]/g, '')}</div></details>
                        : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Activities */}
          <Card className="mb-4 shadow-sm border-0">
            <Card.Header className="bg-transparent fw-bold py-3">Activities in this period ({report.activities.length})</Card.Header>
            <Table responsive hover className="mb-0 align-middle">
              <thead><tr><th>Project</th><th>Phase</th><th>Activity</th><th>Responsible</th><th>Status</th><th>Dates</th></tr></thead>
              <tbody>
                {report.activities.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-4">No activities in this period.</td></tr>}
                {report.activities.map((a, i) => (
                  <tr key={i}>
                    <td className="small">{a.project}</td>
                    <td className="small">{a.phase ?? '—'}</td>
                    <td>{a.title} {a.isCritical && <Badge bg="danger">Critical</Badge>}</td>
                    <td className="small">{a.responsible ?? '—'}</td>
                    <td><Badge bg={STATUS_BADGE[a.status] || 'secondary'}>{STATUS_TEXT[a.status] || a.status}</Badge></td>
                    <td className="small text-nowrap">{a.startDate ? new Date(a.startDate).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—'} – {a.endDate ? new Date(a.endDate).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </Container>
  );
};

export default Reports;
