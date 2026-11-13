import React, { useEffect, useState, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Card, Col, Container, Row, Modal, Form, Badge, ToggleButton, ToggleButtonGroup, Alert, ListGroup } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import ReactMarkdown from 'react-markdown';
import SlotFinder from '../components/meetings/SlotFinder';
import { JoinButton, VideoChoice, VideoSettingsModal, providerName } from '../components/meetings/VideoCall';
import type { VideoMode } from '../components/meetings/VideoCall';
import { ActionItemsModal } from '../components/meetings/ActionItems';
import { browserTimeZone, formatInZone, otherZonesLine, zoneCity } from '../lib/time';

const MAX_SLOTS = 5;
const isScheduled = (m: any) => ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'].includes(m.status);
// The AI assistant also helps after a meeting (e.g. writing the minutes).
const canUseAI = (m: any) => isScheduled(m) || ['IN_PROGRESS', 'COMPLETED'].includes(m.status);
const badgeOf = (m: any) => (isScheduled(m) ? { bg: 'success' } : ['COMPLETED', 'IN_PROGRESS'].includes(m.status) ? { bg: 'secondary' } : m.status === 'CANCELLED' ? { bg: 'danger' } : { bg: 'warning', text: 'dark' as const });
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Voting',
  CONFIRMED: 'Confirmed',
  CALENDAR_SYNCHRONIZED: 'Confirmed · in calendar',
  RESCHEDULED: 'Moved',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Held',
  CANCELLED: 'Cancelled',
};

/** "Thu 12 Nov, 15:00" plus "08:00 New York · 22:00 Tokyo" for the other people's zones (night times highlighted). */
const TimeWithZones = ({ iso, zones, strong = false }: { iso: string; zones: (string | null | undefined)[]; strong?: boolean }) => {
  const others = otherZonesLine(iso, zones);
  return (
    <span>
      <span className={strong ? 'fw-semibold' : ''}>{formatInZone(iso, browserTimeZone())}</span>
      {others.length > 0 && (
        <span className="small d-block" style={{ color: 'var(--text-secondary)' }}>
          {others.map((o, i) => (
            <span key={o.zone}>
              {i > 0 && ' · '}
              <span className={o.night ? 'text-danger fw-semibold' : ''} title={o.night ? 'Outside normal hours for this person' : undefined}>
                {o.night && <i className="bi bi-moon-stars me-1" aria-label="night time"></i>}{o.text}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
};

const emptyForm = { projectId: '', activityId: '', title: '', description: '', durationMin: 30, category: 'OTHER', video: 'auto' as VideoMode, videoUrl: '' };

const Meetings = () => {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [pendingPolls, setPendingPolls] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [notice, setNotice] = useState<{ variant: string; text: string } | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [selectedPoll, setSelectedPoll] = useState<any>(null);
  const [selectedMeetingToFinalize, setSelectedMeetingToFinalize] = useState<any>(null);
  const [finalSlot, setFinalSlot] = useState('');
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [videoMeeting, setVideoMeeting] = useState<any>(null);
  const [todoMeeting, setTodoMeeting] = useState<any>(null);

  // AI State
  const [showAIModal, setShowAIModal] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [draftType, setDraftType] = useState('AGENDA');
  const [generatedDraft, setGeneratedDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const { user } = useContext(AuthContext);
  const location = useLocation();

  // Schedule form
  const [formData, setFormData] = useState(emptyForm);
  const [slots, setSlots] = useState<string[]>([]); // ISO start times
  const [manualSlot, setManualSlot] = useState('');
  const [formError, setFormError] = useState('');

  const fetchData = async () => {
    try {
      const [meetingsRes, pollsRes, projectsRes] = await Promise.all([
        axios.get('/api/meetings'),
        axios.get('/api/meetings/polls/pending'),
        axios.get('/api/projects')
      ]);
      setMeetings(meetingsRes.data);
      setPendingPolls(pollsRes.data);
      setProjects(projectsRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openSchedule = (prefill: Partial<typeof emptyForm> = {}) => {
    setFormData({ ...emptyForm, ...prefill });
    setSlots([]);
    setManualSlot('');
    setFormError('');
    setShowScheduleModal(true);
  };

  useEffect(() => {
    if (location.state && location.state.openScheduleModal) {
      openSchedule({
        projectId: location.state.projectId || '',
        activityId: location.state.activityId || '',
        title: location.state.activityTitle ? `Meeting for: ${location.state.activityTitle}` : ''
      });
      // Clear state so a refresh doesn't pop it up again
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  const project = projects.find(p => p.id === formData.projectId);
  const members: any[] = project?.members || [];
  const memberZones = members.map(m => m.user?.timeZone);

  const toggleSlot = (iso: string) =>
    setSlots(prev => (prev.includes(iso) ? prev.filter(s => s !== iso) : [...prev, iso].sort()));

  const addManualSlot = () => {
    if (!manualSlot) return;
    const iso = new Date(manualSlot).toISOString(); // datetime-local is in this browser's time zone
    if (new Date(iso) <= new Date()) return setFormError('That time is in the past.');
    if (!slots.includes(iso) && slots.length < MAX_SLOTS) toggleSlot(iso);
    setManualSlot('');
    setFormError('');
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slots.length === 0) return setFormError('Add at least one proposed time.');
    try {
      await axios.post('/api/meetings/poll', {
        ...formData,
        videoUrl: formData.video === 'custom' ? formData.videoUrl : undefined,
        proposedSlots: slots,
        participantIds: members.map((m: any) => m.userId),
      });
      setShowScheduleModal(false);
      setNotice({ variant: 'success', text: `Poll sent to ${Math.max(members.length - 1, 0)} participant(s). The meeting is confirmed automatically when a majority votes "Yes" for a time.` });
      fetchData();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Could not create the poll.');
    }
  };

  const handleOpenVote = (poll: any) => {
    setSelectedPoll(poll);
    setVotes({});
    setShowVoteModal(true);
  };

  const handleSubmitVote = async () => {
    const voteArray = Object.keys(votes).map(slot => ({ selectedSlot: slot, availability: votes[slot] }));
    try {
      const res = await axios.post(`/api/meetings/poll/${selectedPoll.id}/vote`, { votes: voteArray });
      setShowVoteModal(false);
      setNotice(res.data.autoConfirmed
        ? { variant: 'success', text: `A majority agreed: "${selectedPoll.meeting.title}" is confirmed for ${formatInZone(res.data.autoConfirmed.startDate, browserTimeZone())} and added to connected calendars.` }
        : { variant: 'info', text: 'Your votes were saved.' });
      fetchData();
    } catch (err: any) {
      setNotice({ variant: 'danger', text: err.response?.data?.error || 'Could not save your votes.' });
    }
  };

  const handleOpenFinalize = (meeting: any) => {
    setSelectedMeetingToFinalize(meeting);
    setFinalSlot('');
    setShowFinalizeModal(true);
  };

  const handleFinalize = async () => {
    if (!finalSlot) return;
    try {
      await axios.post(`/api/meetings/${selectedMeetingToFinalize.id}/finalize`, { finalStartDate: finalSlot });
      setShowFinalizeModal(false);
      fetchData();
    } catch (err: any) {
      setNotice({ variant: 'danger', text: err.response?.data?.error || 'Could not confirm the meeting.' });
    }
  };

  const handleGenerateAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setGeneratedDraft('');
    try {
      const res = await axios.post('/api/ai/generate', { meetingId: selectedMeetingId, draftType, prompt: aiPrompt });
      setGeneratedDraft(res.data.content);
    } catch (err: any) {
      setGeneratedDraft(err.response?.data?.error || 'Failed to generate content');
    } finally {
      setIsGenerating(false);
    }
  };

  const openAIModal = (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setAiPrompt('');
    setGeneratedDraft('');
    setShowAIModal(true);
  };

  const zonesOf = (meeting: any) => (meeting.participants || []).map((p: any) => p.user?.timeZone);

  return (
    <Container fluid>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2>Meetings & Polls</h2>
        <Button variant="primary" onClick={() => openSchedule()} className="shadow-sm">
          <i className="bi bi-calendar-plus me-2" aria-hidden="true"></i>Schedule Meeting
        </Button>
      </div>
      <p className="small mb-4" style={{ color: 'var(--text-secondary)' }}>
        Times are shown in your time zone ({zoneCity(browserTimeZone())}); times for colleagues in other zones are listed underneath.
      </p>

      {notice && <Alert variant={notice.variant} dismissible onClose={() => setNotice(null)}>{notice.text}</Alert>}

      <Row>
        <Col lg={8}>
          <h5 className="mb-3 text-secondary">Your Meetings</h5>
          {meetings.length === 0 ? (
            <Card className="border-0 shadow-sm"><Card.Body className="text-center text-muted p-5">No meetings found. Schedule one to get started!</Card.Body></Card>
          ) : (
            meetings.map(meeting => (
              <Card key={meeting.id} className="mb-3 border-0 shadow-sm custom-hover-card">
                <Card.Body className="d-flex flex-wrap gap-2 justify-content-between align-items-center">
                  <div>
                    <Card.Title className="mb-1">{meeting.title}</Card.Title>
                    <Card.Subtitle className="mb-2 text-primary small"><i className="bi bi-folder2-open me-1" aria-hidden="true"></i>{meeting.project.name}</Card.Subtitle>
                    <div className="text-muted mb-0">
                      <i className="bi bi-clock me-1" aria-hidden="true"></i>
                      {meeting.startDate ? <TimeWithZones iso={meeting.startDate} zones={zonesOf(meeting)} /> : 'Time not decided yet (poll open)'}
                      <span className="small"> · {meeting.durationMin} min</span>
                    </div>
                    <div className="small mt-1" style={{ color: 'var(--text-secondary)' }}>
                      <i className={`bi ${meeting.videoUrl ? 'bi-camera-video' : 'bi-geo-alt'} me-1`} aria-hidden="true"></i>
                      {meeting.status === 'DRAFT' && meeting.videoProvider === 'auto'
                        ? 'Online: the video link is created when the time is confirmed'
                        : providerName(meeting.videoProvider)}
                      {meeting.organizerId === user?.id && !['COMPLETED', 'CANCELLED'].includes(meeting.status) && (
                        <Button variant="link" size="sm" className="p-0 ms-2 align-baseline" onClick={() => setVideoMeeting(meeting)}>Change</Button>
                      )}
                    </div>
                    {meeting.status === 'DRAFT' && meeting.poll && (
                      <div className="small mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {meeting.poll.voted} of {meeting.participants.length} voted · confirmed automatically at {meeting.poll.majority} "Yes" votes for one time
                      </div>
                    )}
                  </div>
                  <div className="text-end">
                    <Badge {...badgeOf(meeting)} className="mb-2 px-3 py-2 rounded-pill">
                      {STATUS_LABEL[meeting.status] || meeting.status}
                    </Badge>
                    <div className="d-flex flex-wrap gap-2 justify-content-end">
                      <JoinButton meeting={meeting} />
                      {meeting.status !== 'CANCELLED' && (
                        <Button variant="outline-secondary" size="sm" onClick={() => setTodoMeeting(meeting)}
                          aria-label={`To-dos for ${meeting.title}: ${meeting.todos?.done ?? 0} of ${meeting.todos?.total ?? 0} done`}>
                          <i className="bi bi-check2-square me-1" aria-hidden="true"></i>To-dos
                          {meeting.todos?.total > 0 && <span className="ms-1">{meeting.todos.done}/{meeting.todos.total}</span>}
                        </Button>
                      )}
                      {canUseAI(meeting) && (
                        <Button variant="outline-primary" size="sm" onClick={() => openAIModal(meeting.id)}>
                          <i className="bi bi-magic me-1" aria-hidden="true"></i> AI Assistant
                        </Button>
                      )}
                      {meeting.status === 'DRAFT' && meeting.organizerId === user?.id && meeting.poll && (
                        <Button variant="success" size="sm" onClick={() => handleOpenFinalize(meeting)}>
                          <i className="bi bi-check-circle me-1" aria-hidden="true"></i> Choose time
                        </Button>
                      )}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            ))
          )}
        </Col>

        <Col lg={4}>
          <h5 className="mb-3 text-secondary">Action Required</h5>
          {pendingPolls.length === 0 ? (
            <Card className="border-0 shadow-sm"><Card.Body className="text-center text-muted p-4">You're all caught up!</Card.Body></Card>
          ) : (
            pendingPolls.map(poll => (
              <Card key={poll.id} className="mb-3 border-0 border-start border-warning border-4 shadow-sm custom-hover-card">
                <Card.Body>
                  <h6 className="fw-bold">{poll.meeting.title}</h6>
                  <small className="text-primary d-block mb-3"><i className="bi bi-folder2-open me-1" aria-hidden="true"></i>{poll.meeting.project.name}</small>
                  <Button variant="warning" size="sm" className="w-100 text-dark fw-semibold" onClick={() => handleOpenVote(poll)}>
                    <i className="bi bi-ui-radios me-1" aria-hidden="true"></i> Vote on Proposed Times
                  </Button>
                </Card.Body>
              </Card>
            ))
          )}
        </Col>
      </Row>

      {/* AI Assistant Modal */}
      <Modal show={showAIModal} onHide={() => setShowAIModal(false)} size="lg" centered>
        <Modal.Header closeButton className="border-0 pb-3">
          <Modal.Title className="fw-bold"><i className="bi bi-magic text-primary me-2" aria-hidden="true"></i>Gemini AI Assistant</Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-4">
          <Form onSubmit={handleGenerateAI}>
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3" controlId="ai-type">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Draft Type</Form.Label>
                  <Form.Select value={draftType} onChange={e => setDraftType(e.target.value)} className="shadow-none">
                    <option value="AGENDA">Meeting Agenda</option>
                    <option value="INVITATION">Email Invitation</option>
                    <option value="REMINDER">Reminder</option>
                    <option value="SUMMARY">Meeting Summary</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={8}>
                <Form.Group className="mb-3" controlId="ai-prompt">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Instructions / Context</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    className="shadow-none"
                    placeholder="e.g. Include a bullet point about the new marketing budget..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>
            <div className="text-end">
              <Button variant="primary" type="submit" disabled={isGenerating} className="px-4 shadow-sm rounded-pill">
                {isGenerating ? <><span className="spinner-border spinner-border-sm me-2"></span>Generating...</> : <><i className="bi bi-stars me-1" aria-hidden="true"></i>Generate</>}
              </Button>
            </div>
          </Form>

          {generatedDraft && (
            <div className="mt-4 p-4 rounded shadow-sm border">
              <h6 className="text-primary fw-bold mb-3 border-bottom pb-2">Generated {draftType}</h6>
              <div className="markdown-body" style={{ fontSize: '0.95rem' }}>
                <ReactMarkdown>{generatedDraft}</ReactMarkdown>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Choose final time (organizer) */}
      {selectedMeetingToFinalize && (
        <Modal show={showFinalizeModal} onHide={() => setShowFinalizeModal(false)} centered>
          <Modal.Header closeButton className="border-0">
            <Modal.Title className="fw-bold">Choose the meeting time</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="text-muted small">
              Votes so far for <strong>{selectedMeetingToFinalize.title}</strong> ({selectedMeetingToFinalize.poll.voted} of {selectedMeetingToFinalize.participants.length} people voted).
            </p>
            {selectedMeetingToFinalize.poll.tallies.map((t: any, idx: number) => (
              <div key={t.start} className="mb-2 p-3 rounded border d-flex justify-content-between align-items-center" onClick={() => setFinalSlot(t.start)} style={{ cursor: 'pointer' }}>
                <Form.Check
                  type="radio"
                  id={`finalize-${idx}`}
                  name="finalizeSlot"
                  label={<TimeWithZones iso={t.start} zones={zonesOf(selectedMeetingToFinalize)} strong />}
                  checked={finalSlot === t.start}
                  onChange={() => setFinalSlot(t.start)}
                />
                <span className="small text-nowrap ms-2">
                  <Badge bg="success" className="me-1">{t.yes} yes</Badge>
                  <Badge bg="warning" text="dark" className="me-1">{t.ifNecessary} if needed</Badge>
                  <Badge bg="danger">{t.no} no</Badge>
                </span>
              </div>
            ))}
          </Modal.Body>
          <Modal.Footer className="border-0">
            <Button variant="secondary" onClick={() => setShowFinalizeModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="success" onClick={handleFinalize} disabled={!finalSlot} className="rounded-pill px-4 shadow-sm">Confirm Meeting</Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Schedule Meeting Modal */}
      <Modal show={showScheduleModal} onHide={() => setShowScheduleModal(false)} centered size="lg">
        <Form onSubmit={handleCreatePoll}>
          <Modal.Header closeButton className="border-0">
            <Modal.Title className="fw-bold">Schedule a Meeting</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {formError && <Alert variant="danger" className="py-2">{formError}</Alert>}
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3" controlId="sched-project">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Project</Form.Label>
                  <Form.Select required value={formData.projectId} onChange={e => { setFormData({ ...formData, projectId: e.target.value, activityId: '' }); setSlots([]); }} className="shadow-none">
                    <option value="">Select a project...</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Form.Select>
                  {project && <Form.Text>Participants: all {members.length} project members.</Form.Text>}
                </Form.Group>
              </Col>
              <Col md={6}>
                {project?.activities?.length > 0 && (
                  <Form.Group className="mb-3" controlId="sched-activity">
                    <Form.Label className="fw-semibold text-muted small text-uppercase">Activity (Optional)</Form.Label>
                    <Form.Select value={formData.activityId} onChange={e => setFormData({ ...formData, activityId: e.target.value })} className="shadow-none">
                      <option value="">None</option>
                      {project.activities.map((act: any) => <option key={act.id} value={act.id}>{act.title}</option>)}
                    </Form.Select>
                  </Form.Group>
                )}
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3" controlId="sched-title">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Meeting Title</Form.Label>
                  <Form.Control type="text" required className="shadow-none" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3" controlId="sched-type">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Type</Form.Label>
                  <Form.Select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                    <option value="STRATEGIC">Strategic</option>
                    <option value="PLANNING">Planning</option>
                    <option value="REVIEW">Review</option>
                    <option value="STATUS">Status update</option>
                    <option value="OTHER">Other</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3" controlId="sched-duration">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Duration</Form.Label>
                  <Form.Select value={formData.durationMin} onChange={e => setFormData({ ...formData, durationMin: Number(e.target.value) })}>
                    {[15, 30, 45, 60, 90, 120, 180].map(m => (
                      <option key={m} value={m}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <div className="mb-3">
              <VideoChoice idPrefix="sched" mode={formData.video} url={formData.videoUrl}
                onChange={(video, videoUrl) => setFormData({ ...formData, video, videoUrl })} />
            </div>

            <h6 className="fw-bold text-primary border-bottom pb-2 mb-3">Proposed times ({slots.length}/{MAX_SLOTS})</h6>

            <SlotFinder
              projectId={formData.projectId}
              durationMin={formData.durationMin}
              participantIds={members.map((m: any) => m.userId)}
              selected={slots}
              onToggle={toggleSlot}
              maxSelected={MAX_SLOTS}
            />

            <Form.Label className="small mb-1" htmlFor="sched-manual">Or add a time yourself (your time zone):</Form.Label>
            <div className="d-flex gap-2 mb-3">
              <Form.Control id="sched-manual" type="datetime-local" size="sm" value={manualSlot} onChange={e => setManualSlot(e.target.value)} style={{ maxWidth: 260 }} />
              <Button size="sm" variant="outline-primary" onClick={addManualSlot} disabled={!manualSlot || slots.length >= MAX_SLOTS}>Add</Button>
            </div>

            {slots.length > 0 && (
              <ListGroup>
                {slots.map(s => (
                  <ListGroup.Item key={s} className="d-flex justify-content-between align-items-center">
                    <TimeWithZones iso={s} zones={memberZones} strong />
                    <Button variant="link" size="sm" className="text-danger" onClick={() => toggleSlot(s)} aria-label="Remove this time">
                      <i className="bi bi-x-lg" aria-hidden="true"></i>
                    </Button>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
          </Modal.Body>
          <Modal.Footer className="border-0">
            <Button variant="secondary" onClick={() => setShowScheduleModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="primary" type="submit" disabled={slots.length === 0} className="rounded-pill px-4 shadow-sm">Send Poll</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <ActionItemsModal meeting={todoMeeting} onHide={() => setTodoMeeting(null)} onChanged={fetchData} />

      <VideoSettingsModal meeting={videoMeeting} onHide={() => setVideoMeeting(null)}
        onSaved={() => { setVideoMeeting(null); setNotice({ variant: 'success', text: 'The video call was updated.' }); fetchData(); }} />

      {/* Voting Modal */}
      {selectedPoll && (
        <Modal show={showVoteModal} onHide={() => setShowVoteModal(false)} centered>
          <Modal.Header closeButton className="border-0">
            <Modal.Title className="fw-bold">Vote on Meeting Time</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <h5 className="fw-bold text-primary">{selectedPoll.meeting.title}</h5>
            {selectedPoll.meeting.description && <p className="text-muted small">{selectedPoll.meeting.description}</p>}
            <div className="alert alert-info py-2 small mb-4">
              <i className="bi bi-info-circle me-2" aria-hidden="true"></i>
              Times are in your time zone ({zoneCity(browserTimeZone())}). The meeting is confirmed automatically when a majority says "Yes" to one time.
            </div>

            {selectedPoll.options.map((slot: string, idx: number) => (
              <div key={slot} className="mb-3 p-3 border rounded shadow-sm">
                <div className="mb-3 d-flex align-items-start">
                  <i className="bi bi-calendar-event text-primary me-2 mt-1" aria-hidden="true"></i>
                  <TimeWithZones iso={slot} zones={(selectedPoll.meeting.participants || []).map((p: any) => p.user?.timeZone)} strong />
                </div>
                <ToggleButtonGroup type="radio" name={`vote-${idx}`} className="w-100 d-flex" value={votes[slot]} onChange={(val) => setVotes({ ...votes, [slot]: val })}>
                  <ToggleButton id={`yes-${idx}`} value="YES" variant={votes[slot] === 'YES' ? 'success' : 'outline-success'} className="flex-fill fw-semibold">Yes</ToggleButton>
                  <ToggleButton id={`ifneed-${idx}`} value="IF_NECESSARY" variant={votes[slot] === 'IF_NECESSARY' ? 'warning' : 'outline-warning'} className="flex-fill fw-semibold">If Needed</ToggleButton>
                  <ToggleButton id={`no-${idx}`} value="NO" variant={votes[slot] === 'NO' ? 'danger' : 'outline-danger'} className="flex-fill fw-semibold">No</ToggleButton>
                </ToggleButtonGroup>
              </div>
            ))}
          </Modal.Body>
          <Modal.Footer className="border-0">
            <Button variant="secondary" onClick={() => setShowVoteModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="primary" onClick={handleSubmitVote} disabled={Object.keys(votes).length !== selectedPoll.options.length} className="rounded-pill px-4 shadow-sm">Submit Votes</Button>
          </Modal.Footer>
        </Modal>
      )}
    </Container>
  );
};

export default Meetings;
