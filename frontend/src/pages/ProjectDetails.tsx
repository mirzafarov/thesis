import { useCallback, useEffect, useState, useContext } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Card, Row, Col, Button, ListGroup, Form, Modal, Alert, ButtonGroup } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import GanttChart from '../components/gantt/GanttChart';
import type { GanttActivity, GanttItem, GanttPhase } from '../components/gantt/GanttChart';
import { dayToISO, isoToInput, formatDayLong, toDay } from '../components/gantt/dates';

interface Member {
  id: string;
  userId: string;
  role: 'MANAGER' | 'EMPLOYEE' | 'OBSERVER';
  user: { id: string; firstName: string; lastName: string; email: string };
}

interface Activity extends GanttActivity {
  description: string | null;
  responsibleId: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  members: Member[];
  phases: GanttPhase[];
  activities: Activity[];
}

interface MeetingSuggestion {
  meetingId: string;
  title: string;
  currentStart: string;
  suggestedStart: string;
}

const STATUS_OPTIONS: { value: GanttActivity['status']; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DELAYED', label: 'Delayed' },
];

const emptyActivity = {
  id: '', title: '', description: '', phaseId: '', responsibleId: '', startDate: '', endDate: '',
  status: 'PENDING' as GanttActivity['status'], isCritical: false,
};
const emptyPhase = { id: '', name: '', startDate: '', endDate: '', isMilestone: false };

const apiError = (err: any, fallback: string) => err?.response?.data?.error || fallback;

const ProjectDetails = () => {
  const { id } = useParams();
  const { user } = useContext(AuthContext);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'gantt' | 'list'>(() => {
    try { return (localStorage.getItem('projectView') as 'gantt' | 'list') || 'gantt'; } catch { return 'gantt'; }
  });
  const [pageError, setPageError] = useState('');

  // Activity form (create + edit)
  const [activityForm, setActivityForm] = useState<typeof emptyActivity | null>(null);
  const [activityError, setActivityError] = useState('');
  // Phase form (create + edit)
  const [phaseForm, setPhaseForm] = useState<typeof emptyPhase | null>(null);
  const [phaseError, setPhaseError] = useState('');
  // Confirm delete
  const [toDelete, setToDelete] = useState<{ kind: 'activity' | 'phase'; id: string; name: string } | null>(null);
  // Suggested meeting moves after an activity moved
  const [suggestions, setSuggestions] = useState<{ activity: string; days: number; items: MeetingSuggestion[] } | null>(null);

  // Project edit + invite
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editProjectData, setEditProjectData] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [inviteRole, setInviteRole] = useState<Member['role']>('EMPLOYEE');
  const [inviteError, setInviteError] = useState('');

  const fetchProject = useCallback(async () => {
    try {
      const res = await axios.get(`/api/projects/${id}`);
      setProject(res.data);
      setEditProjectData({
        name: res.data.name,
        description: res.data.description || '',
        startDate: isoToInput(res.data.startDate),
        endDate: isoToInput(res.data.endDate),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    try { localStorage.setItem('projectView', view); } catch { /* storage unavailable */ }
  }, [view]);

  if (loading) return <Container className="p-4">Loading...</Container>;
  if (!project) return <Container className="p-4">Project not found, or you are not a member of it.</Container>;

  const myMembership = project.members.find(m => m.userId === user?.id);
  const isManager = myMembership?.role === 'MANAGER';
  const canUpdateStatus = (a: Activity) => isManager || a.responsibleId === user?.id;

  // ---------- Activity actions ----------

  const openActivity = (a?: Activity, defaults: Partial<typeof emptyActivity> = {}) => {
    setActivityError('');
    setActivityForm(a ? {
      id: a.id,
      title: a.title,
      description: a.description || '',
      phaseId: a.phaseId || '',
      responsibleId: a.responsibleId || '',
      startDate: isoToInput(a.startDate),
      endDate: isoToInput(a.endDate),
      status: a.status,
      isCritical: a.isCritical,
    } : { ...emptyActivity, ...defaults });
  };

  const showSuggestions = (activityTitle: string, data: any) => {
    if (data?.meetingSuggestions?.length > 0) {
      setSuggestions({ activity: activityTitle, days: data.shiftDays, items: data.meetingSuggestions });
    }
  };

  const saveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityForm) return;
    const f = activityForm;
    const body = {
      title: f.title,
      description: f.description,
      phaseId: f.phaseId || null,
      responsibleId: f.responsibleId || null,
      startDate: f.startDate || null,
      endDate: f.endDate || null,
      status: f.status,
      isCritical: f.isCritical,
    };
    try {
      if (f.id) {
        const res = await axios.put(`/api/projects/${id}/activities/${f.id}`, body);
        showSuggestions(f.title, res.data);
      } else {
        await axios.post(`/api/projects/${id}/activities`, body);
      }
      setActivityForm(null);
      fetchProject();
    } catch (err) {
      setActivityError(apiError(err, 'Failed to save activity'));
    }
  };

  const updateStatus = async (activityId: string, status: string) => {
    try {
      await axios.put(`/api/projects/${id}/activities/${activityId}`, { status });
      fetchProject();
    } catch (err) {
      setPageError(apiError(err, 'Failed to update status'));
    }
  };

  // ---------- Phase actions ----------

  const openPhase = (p?: GanttPhase) => {
    setPhaseError('');
    setPhaseForm(p ? {
      id: p.id, name: p.name, startDate: isoToInput(p.startDate), endDate: isoToInput(p.endDate), isMilestone: p.isMilestone,
    } : { ...emptyPhase });
  };

  const savePhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phaseForm) return;
    const body = {
      name: phaseForm.name,
      startDate: phaseForm.startDate,
      endDate: phaseForm.isMilestone ? phaseForm.startDate : phaseForm.endDate,
      isMilestone: phaseForm.isMilestone,
    };
    try {
      if (phaseForm.id) await axios.put(`/api/projects/${id}/phases/${phaseForm.id}`, body);
      else await axios.post(`/api/projects/${id}/phases`, body);
      setPhaseForm(null);
      fetchProject();
    } catch (err) {
      setPhaseError(apiError(err, 'Failed to save phase'));
    }
  };

  // ---------- Gantt callbacks ----------

  const onGanttMove = async (target: GanttItem, startDay: number, endDay: number) => {
    setPageError('');
    const body = { startDate: dayToISO(startDay), endDate: dayToISO(endDay) };
    try {
      if (target.kind === 'phase') {
        await axios.put(`/api/projects/${id}/phases/${target.item.id}`, body);
      } else {
        const res = await axios.put(`/api/projects/${id}/activities/${target.item.id}`, body);
        showSuggestions(target.item.title, res.data);
      }
    } catch (err) {
      setPageError(apiError(err, 'Failed to move item'));
    }
    await fetchProject();
  };

  const onGanttOpen = (target: GanttItem) => {
    if (target.kind === 'phase') openPhase(target.item);
    else openActivity(project.activities.find(a => a.id === target.item.id));
  };

  const applySuggestions = async () => {
    if (!suggestions) return;
    try {
      for (const s of suggestions.items) {
        await axios.put(`/api/meetings/${s.meetingId}/reschedule`, { startDate: s.suggestedStart });
      }
    } catch (err) {
      setPageError(apiError(err, 'Failed to move some meetings'));
    }
    setSuggestions(null);
    fetchProject();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await axios.delete(`/api/projects/${id}/${toDelete.kind === 'phase' ? 'phases' : 'activities'}/${toDelete.id}`);
      setToDelete(null);
      setActivityForm(null);
      setPhaseForm(null);
      fetchProject();
    } catch (err) {
      setPageError(apiError(err, `Failed to delete ${toDelete.kind}`));
      setToDelete(null);
    }
  };

  // ---------- Project + members ----------

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.put(`/api/projects/${id}`, {
        ...editProjectData,
        startDate: editProjectData.startDate || null,
        endDate: editProjectData.endDate || null,
      });
      setShowEditProjectModal(false);
      fetchProject();
    } catch (err) {
      setPageError(apiError(err, 'Failed to update project'));
    }
  };

  const handleSearchUsers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (q.length > 2) {
      try {
        const res = await axios.get('/api/users/search', { params: { email: q } });
        const existingIds = project.members.map(m => m.userId);
        setSearchResults(res.data.filter((u: any) => !existingIds.includes(u.id)));
      } catch (err) {
        console.error(err);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleInvite = async (userId: string) => {
    try {
      await axios.post(`/api/projects/${id}/members`, { newMemberUserId: userId, role: inviteRole });
      setSearchQuery('');
      setSearchResults([]);
      setShowInviteModal(false);
      fetchProject();
    } catch (err) {
      setInviteError(apiError(err, 'Failed to invite user'));
    }
  };

  const changeRole = async (memberUserId: string, role: Member['role']) => {
    try {
      await axios.put(`/api/projects/${id}/members/${memberUserId}`, { role });
      fetchProject();
    } catch (err) {
      setPageError(apiError(err, 'Failed to change role'));
    }
  };

  const removeMember = async (memberUserId: string) => {
    try {
      await axios.delete(`/api/projects/${id}/members/${memberUserId}`);
      fetchProject();
    } catch (err) {
      setPageError(apiError(err, 'Failed to remove member'));
    }
  };

  const handleExportPDF = () => {
    Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([{ jsPDF }, { default: autoTable }]) => {
      const doc = new jsPDF();
      const date = (iso: string | null) => (iso ? formatDayLong(toDay(iso)) : '—');

      doc.setFontSize(20);
      doc.text(`Project Report: ${project.name}`, 14, 22);
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(project.description || 'No description provided.', 14, 30);
      doc.setTextColor(0);

      const section = (title: string, y: number) => { doc.setFontSize(16); doc.text(title, 14, y); };
      const lastY = () => (doc as any).lastAutoTable?.finalY || 40;

      section('Team Members', 45);
      autoTable(doc, {
        startY: 50,
        head: [['Name', 'Email', 'Role']],
        body: project.members.map(m => [`${m.user.firstName} ${m.user.lastName}`, m.user.email, m.role]),
      });

      section('Phases & Milestones', lastY() + 15);
      autoTable(doc, {
        startY: lastY() + 20,
        head: [['Phase', 'Type', 'Start', 'End']],
        body: project.phases.map(p => [p.name, p.isMilestone ? 'Milestone' : 'Phase', date(p.startDate), date(p.endDate)]),
      });

      const phaseName = (pid: string | null) => project.phases.find(p => p.id === pid)?.name || '—';
      section('Activities', lastY() + 15);
      autoTable(doc, {
        startY: lastY() + 20,
        head: [['Activity', 'Phase', 'Responsible', 'Status', 'Start', 'End']],
        body: project.activities.map(a => [
          a.title + (a.isCritical ? ' (critical)' : ''),
          phaseName(a.phaseId),
          a.responsible ? `${a.responsible.firstName} ${a.responsible.lastName}` : '—',
          STATUS_OPTIONS.find(s => s.value === a.status)?.label || a.status,
          date(a.startDate),
          date(a.endDate),
        ]),
      });

      doc.save(`${project.name.replace(/\s+/g, '_')}_Report.pdf`);
      // Report generation is a critical action: record it in the audit log.
      axios.post(`/api/projects/${id}/report-log`, { format: 'PDF' }).catch(() => {});
    });
  };

  const memberName = (m: Member) => `${m.user.firstName} ${m.user.lastName}`;

  return (
    <Container fluid>
      <div className="mb-4">
        <Link to="/projects" className="text-decoration-none mb-2 d-inline-block">
          <i className="bi bi-arrow-left me-1" aria-hidden="true"></i> Back to Projects
        </Link>
        <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center">
          <h2 className="mb-0">{project.name}</h2>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={handleExportPDF}>
              <i className="bi bi-file-earmark-pdf-fill me-1" aria-hidden="true"></i> Export PDF
            </Button>
            {isManager && <Button variant="primary" onClick={() => setShowEditProjectModal(true)}>Edit Project</Button>}
          </div>
        </div>
        {project.description && <p className="text-muted mt-2 mb-0">{project.description}</p>}
        {(project.startDate || project.endDate) && (
          <p className="small text-muted mb-0">
            <i className="bi bi-calendar-range me-1" aria-hidden="true"></i>
            {project.startDate ? formatDayLong(toDay(project.startDate)) : '…'} – {project.endDate ? formatDayLong(toDay(project.endDate)) : '…'}
          </p>
        )}
      </div>

      {pageError && <Alert variant="danger" dismissible onClose={() => setPageError('')}>{pageError}</Alert>}

      <Card className="mb-4 shadow-sm border-0">
        <Card.Header className="bg-transparent d-flex flex-wrap gap-2 justify-content-between align-items-center py-3 border-bottom-0">
          <div className="d-flex align-items-center gap-3">
            <h5 className="mb-0 fw-bold">Plan</h5>
            <ButtonGroup size="sm" aria-label="View">
              <Button variant={view === 'gantt' ? 'primary' : 'outline-secondary'} aria-pressed={view === 'gantt'} onClick={() => setView('gantt')}>
                <i className="bi bi-bar-chart-steps me-1" aria-hidden="true"></i>Gantt chart
              </Button>
              <Button variant={view === 'list' ? 'primary' : 'outline-secondary'} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <i className="bi bi-list-ul me-1" aria-hidden="true"></i>List
              </Button>
            </ButtonGroup>
          </div>
          {isManager && (
            <div className="d-flex gap-2">
              <Button variant="outline-primary" size="sm" className="rounded-pill" onClick={() => openPhase()}>
                <i className="bi bi-flag me-1" aria-hidden="true"></i> Add Phase
              </Button>
              <Button variant="outline-primary" size="sm" className="rounded-pill" onClick={() => openActivity()}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true"></i> Add Activity
              </Button>
            </div>
          )}
        </Card.Header>
        <Card.Body className="pt-0">
          {view === 'gantt' ? (
            <GanttChart
              phases={project.phases}
              activities={project.activities}
              readOnly={!isManager}
              onMove={onGanttMove}
              onOpen={onGanttOpen}
            />
          ) : (
            <ListGroup variant="flush">
              {project.activities.length === 0 && (
                <ListGroup.Item className="p-4 text-center text-muted border-0">No activities found.</ListGroup.Item>
              )}
              {project.activities.map(act => (
                <ListGroup.Item key={act.id} className="d-flex flex-wrap gap-2 justify-content-between align-items-center p-3">
                  <div>
                    <h6 className="mb-1">
                      {act.title}
                      {act.isCritical && <span className="badge rounded-pill text-bg-danger ms-2">Critical</span>}
                    </h6>
                    <small className="text-muted d-block">
                      {project.phases.find(p => p.id === act.phaseId)?.name || 'Not in a phase'}
                      {act.startDate && ` · ${formatDayLong(toDay(act.startDate))} – ${act.endDate ? formatDayLong(toDay(act.endDate)) : '…'}`}
                      {act.responsible && ` · ${act.responsible.firstName} ${act.responsible.lastName}`}
                    </small>
                  </div>
                  <div className="d-flex align-items-center">
                    <Form.Select
                      size="sm"
                      aria-label={`Status of ${act.title}`}
                      value={act.status}
                      onChange={e => updateStatus(act.id, e.target.value)}
                      disabled={!canUpdateStatus(act)}
                      className="me-2 rounded-pill shadow-none"
                      style={{ width: '140px', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Form.Select>
                    <Link
                      to="/meetings"
                      state={{ openScheduleModal: true, projectId: project.id, activityId: act.id, activityTitle: act.title }}
                      className="btn btn-light btn-sm rounded-pill border me-2"
                      title="Schedule a meeting for this activity"
                      aria-label={`Schedule a meeting for ${act.title}`}
                    >
                      <i className="bi bi-calendar-plus" aria-hidden="true"></i>
                    </Link>
                    <Button variant="light" size="sm" className="rounded-pill border" onClick={() => openActivity(act)} aria-label={`Open ${act.title}`}>
                      <i className={`bi ${isManager ? 'bi-pencil' : 'bi-eye'}`} aria-hidden="true"></i>
                    </Button>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>

      <Row>
        <Col lg={6}>
          <Card className="shadow-sm border-0 mb-4">
            <Card.Header className="bg-transparent d-flex justify-content-between align-items-center py-3 border-bottom-0">
              <h5 className="mb-0 fw-bold">Team Members</h5>
              {isManager && (
                <Button variant="outline-primary" size="sm" onClick={() => { setInviteError(''); setShowInviteModal(true); }} className="rounded-pill">
                  <i className="bi bi-person-plus-fill me-1" aria-hidden="true"></i> Invite
                </Button>
              )}
            </Card.Header>
            <ListGroup variant="flush">
              {project.members.map(member => (
                <ListGroup.Item key={member.id} className="d-flex justify-content-between align-items-center py-3">
                  <div className="d-flex align-items-center">
                    <div className="bg-light rounded-circle d-flex align-items-center justify-content-center me-3" style={{ width: '40px', height: '40px' }}>
                      <i className="bi bi-person text-secondary fs-5" aria-hidden="true"></i>
                    </div>
                    <div>
                      <strong className="d-block">{memberName(member)}</strong>
                      <small className="text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>{member.role} • {member.user.email}</small>
                    </div>
                  </div>
                  {isManager && member.userId !== user?.id && (
                    <div className="d-flex align-items-center gap-1">
                      <Form.Select
                        size="sm"
                        aria-label={`Role of ${memberName(member)}`}
                        value={member.role}
                        onChange={e => changeRole(member.userId, e.target.value as Member['role'])}
                        style={{ width: 130 }}
                      >
                        <option value="MANAGER">Manager</option>
                        <option value="EMPLOYEE">Employee</option>
                        <option value="OBSERVER">Observer</option>
                      </Form.Select>
                      <Button variant="light" size="sm" className="text-danger border-0" aria-label={`Remove ${memberName(member)}`} onClick={() => removeMember(member.user.id)}>
                        <i className="bi bi-trash" aria-hidden="true"></i>
                      </Button>
                    </div>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Card>
        </Col>
      </Row>

      {/* Activity modal */}
      <Modal show={!!activityForm} onHide={() => setActivityForm(null)} centered>
        {activityForm && (
          <Form onSubmit={saveActivity}>
            <Modal.Header closeButton>
              <Modal.Title>{activityForm.id ? (isManager ? 'Edit Activity' : 'Activity') : 'Add Activity'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {activityError && <Alert variant="danger">{activityError}</Alert>}
              <fieldset disabled={!isManager}>
                <Form.Group className="mb-3" controlId="act-title">
                  <Form.Label>Title</Form.Label>
                  <Form.Control required value={activityForm.title} onChange={e => setActivityForm({ ...activityForm, title: e.target.value })} />
                </Form.Group>
                <Form.Group className="mb-3" controlId="act-desc">
                  <Form.Label>Description</Form.Label>
                  <Form.Control as="textarea" rows={2} value={activityForm.description} onChange={e => setActivityForm({ ...activityForm, description: e.target.value })} />
                </Form.Group>
                <Row>
                  <Col sm={6}>
                    <Form.Group className="mb-3" controlId="act-phase">
                      <Form.Label>Phase</Form.Label>
                      <Form.Select value={activityForm.phaseId} onChange={e => setActivityForm({ ...activityForm, phaseId: e.target.value })}>
                        <option value="">Not in a phase</option>
                        {project.phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group className="mb-3" controlId="act-resp">
                      <Form.Label>Responsible</Form.Label>
                      <Form.Select value={activityForm.responsibleId} onChange={e => setActivityForm({ ...activityForm, responsibleId: e.target.value })}>
                        <option value="">Nobody yet</option>
                        {project.members.map(m => <option key={m.userId} value={m.userId}>{memberName(m)}</option>)}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group className="mb-3" controlId="act-start">
                      <Form.Label>Start date</Form.Label>
                      <Form.Control type="date" value={activityForm.startDate} onChange={e => setActivityForm({ ...activityForm, startDate: e.target.value })} />
                    </Form.Group>
                  </Col>
                  <Col sm={6}>
                    <Form.Group className="mb-3" controlId="act-end">
                      <Form.Label>End date</Form.Label>
                      <Form.Control type="date" min={activityForm.startDate || undefined} value={activityForm.endDate} onChange={e => setActivityForm({ ...activityForm, endDate: e.target.value })} />
                    </Form.Group>
                  </Col>
                </Row>
              </fieldset>
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-3" controlId="act-status">
                    <Form.Label>Status</Form.Label>
                    <Form.Select
                      value={activityForm.status}
                      disabled={!isManager}
                      onChange={e => setActivityForm({ ...activityForm, status: e.target.value as GanttActivity['status'] })}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col sm={6} className="d-flex align-items-center">
                  <Form.Check
                    id="act-critical"
                    type="switch"
                    disabled={!isManager}
                    label="Critical activity"
                    checked={activityForm.isCritical}
                    onChange={e => setActivityForm({ ...activityForm, isCritical: e.target.checked })}
                  />
                </Col>
              </Row>
              {activityForm.id && (() => {
                const meetings = project.activities.find(a => a.id === activityForm.id)?.meetings || [];
                return meetings.length > 0 && (
                  <div className="small">
                    <div className="fw-semibold mb-1">Linked meetings</div>
                    <ul className="mb-0 ps-3">
                      {meetings.map(m => (
                        <li key={m.id}>{m.title} — {m.startDate ? new Date(m.startDate).toLocaleString() : 'time not decided yet'}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </Modal.Body>
            <Modal.Footer className="justify-content-between">
              <div>
                {isManager && activityForm.id && (
                  <Button variant="outline-danger" onClick={() => setToDelete({ kind: 'activity', id: activityForm.id, name: activityForm.title })}>
                    <i className="bi bi-trash me-1" aria-hidden="true"></i>Delete
                  </Button>
                )}
              </div>
              <div className="d-flex gap-2">
                {activityForm.id && (
                  <Link
                    to="/meetings"
                    state={{ openScheduleModal: true, projectId: project.id, activityId: activityForm.id, activityTitle: activityForm.title }}
                    className="btn btn-outline-secondary"
                  >
                    <i className="bi bi-calendar-plus me-1" aria-hidden="true"></i>Schedule meeting
                  </Link>
                )}
                <Button variant="secondary" onClick={() => setActivityForm(null)}>{isManager ? 'Cancel' : 'Close'}</Button>
                {isManager && <Button variant="primary" type="submit">Save</Button>}
              </div>
            </Modal.Footer>
          </Form>
        )}
      </Modal>

      {/* Phase modal */}
      <Modal show={!!phaseForm} onHide={() => setPhaseForm(null)} centered>
        {phaseForm && (
          <Form onSubmit={savePhase}>
            <Modal.Header closeButton>
              <Modal.Title>{phaseForm.id ? (isManager ? 'Edit Phase' : 'Phase') : 'Add Phase'}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {phaseError && <Alert variant="danger">{phaseError}</Alert>}
              <fieldset disabled={!isManager}>
                <Form.Group className="mb-3" controlId="phase-name">
                  <Form.Label>Name</Form.Label>
                  <Form.Control required placeholder="e.g. Design, Development, Final report" value={phaseForm.name} onChange={e => setPhaseForm({ ...phaseForm, name: e.target.value })} />
                </Form.Group>
                <Form.Check
                  className="mb-3"
                  id="phase-milestone"
                  type="switch"
                  label="Milestone (a single key date, e.g. a deadline)"
                  checked={phaseForm.isMilestone}
                  onChange={e => setPhaseForm({ ...phaseForm, isMilestone: e.target.checked })}
                />
                <Row>
                  <Col sm={6}>
                    <Form.Group className="mb-3" controlId="phase-start">
                      <Form.Label>{phaseForm.isMilestone ? 'Date' : 'Start date'}</Form.Label>
                      <Form.Control type="date" required value={phaseForm.startDate} onChange={e => setPhaseForm({ ...phaseForm, startDate: e.target.value })} />
                    </Form.Group>
                  </Col>
                  {!phaseForm.isMilestone && (
                    <Col sm={6}>
                      <Form.Group className="mb-3" controlId="phase-end">
                        <Form.Label>End date</Form.Label>
                        <Form.Control type="date" required min={phaseForm.startDate || undefined} value={phaseForm.endDate} onChange={e => setPhaseForm({ ...phaseForm, endDate: e.target.value })} />
                      </Form.Group>
                    </Col>
                  )}
                </Row>
              </fieldset>
            </Modal.Body>
            <Modal.Footer className="justify-content-between">
              <div>
                {isManager && phaseForm.id && (
                  <Button variant="outline-danger" onClick={() => setToDelete({ kind: 'phase', id: phaseForm.id, name: phaseForm.name })}>
                    <i className="bi bi-trash me-1" aria-hidden="true"></i>Delete
                  </Button>
                )}
              </div>
              <div className="d-flex gap-2">
                {isManager && phaseForm.id && (
                  <Button variant="outline-secondary" onClick={() => { const pid = phaseForm.id; setPhaseForm(null); openActivity(undefined, { phaseId: pid }); }}>
                    <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>Add activity here
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setPhaseForm(null)}>{isManager ? 'Cancel' : 'Close'}</Button>
                {isManager && <Button variant="primary" type="submit">Save</Button>}
              </div>
            </Modal.Footer>
          </Form>
        )}
      </Modal>

      {/* Suggest moving linked meetings */}
      <Modal show={!!suggestions} onHide={() => setSuggestions(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-calendar2-week me-2" aria-hidden="true"></i>Move linked meetings too?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {suggestions && (
            <>
              <p>
                <strong>{suggestions.activity}</strong> moved {Math.abs(suggestions.days)} day{Math.abs(suggestions.days) === 1 ? '' : 's'} {suggestions.days > 0 ? 'later' : 'earlier'}.
                These meetings are linked to it:
              </p>
              <ul className="ps-3">
                {suggestions.items.map(s => (
                  <li key={s.meetingId} className="mb-1">
                    <strong>{s.title}</strong><br />
                    <span className="text-muted">{new Date(s.currentStart).toLocaleString()}</span>
                    {' → '}
                    <span className="fw-semibold">{new Date(s.suggestedStart).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="small text-muted mb-0">Participants' Google Calendars are not updated automatically when a meeting is moved.</p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSuggestions(null)}>Keep current times</Button>
          <Button variant="primary" onClick={applySuggestions}>Move meetings</Button>
        </Modal.Footer>
      </Modal>

      {/* Delete confirmation */}
      <Modal show={!!toDelete} onHide={() => setToDelete(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>Delete {toDelete?.kind}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0">
            Delete <strong>{toDelete?.name}</strong>? This cannot be undone.
            {toDelete?.kind === 'phase' && ' Its activities are kept and moved to "Not in a phase".'}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setToDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>Delete</Button>
        </Modal.Footer>
      </Modal>

      {/* Edit project */}
      <Modal show={showEditProjectModal} onHide={() => setShowEditProjectModal(false)}>
        <Form onSubmit={handleEditProject}>
          <Modal.Header closeButton>
            <Modal.Title>Edit Project</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3" controlId="proj-name">
              <Form.Label>Project Name</Form.Label>
              <Form.Control type="text" required value={editProjectData.name} onChange={e => setEditProjectData({ ...editProjectData, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3" controlId="proj-desc">
              <Form.Label>Description</Form.Label>
              <Form.Control as="textarea" rows={3} value={editProjectData.description} onChange={e => setEditProjectData({ ...editProjectData, description: e.target.value })} />
            </Form.Group>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-3" controlId="proj-start">
                  <Form.Label>Start date</Form.Label>
                  <Form.Control type="date" value={editProjectData.startDate} onChange={e => setEditProjectData({ ...editProjectData, startDate: e.target.value })} />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-3" controlId="proj-end">
                  <Form.Label>End date</Form.Label>
                  <Form.Control type="date" min={editProjectData.startDate || undefined} value={editProjectData.endDate} onChange={e => setEditProjectData({ ...editProjectData, endDate: e.target.value })} />
                </Form.Group>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowEditProjectModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Save Changes</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Invite member */}
      <Modal show={showInviteModal} onHide={() => setShowInviteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Invite Team Member</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {inviteError && <div className="alert alert-danger">{inviteError}</div>}
          <Form.Group className="mb-3" controlId="invite-role">
            <Form.Label>Role in this project</Form.Label>
            <Form.Select value={inviteRole} onChange={e => setInviteRole(e.target.value as Member['role'])}>
              <option value="EMPLOYEE">Employee</option>
              <option value="OBSERVER">Observer (view only)</option>
              <option value="MANAGER">Manager</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3" controlId="invite-search">
            <Form.Label>Search by Email</Form.Label>
            <Form.Control type="text" placeholder="e.g. john@example.com" value={searchQuery} onChange={handleSearchUsers} />
          </Form.Group>
          {searchResults.length > 0 && (
            <ListGroup>
              {searchResults.map(u => (
                <ListGroup.Item key={u.id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <strong>{u.firstName} {u.lastName}</strong><br />
                    <small className="text-muted">{u.email}</small>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => handleInvite(u.id)}>Invite</Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
          {searchQuery.length > 2 && searchResults.length === 0 && (
            <p className="text-muted mt-2">No users found matching that email.</p>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default ProjectDetails;
