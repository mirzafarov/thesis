import React, { useEffect, useState, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Card, Col, Container, Row, Modal, Form, Badge, ListGroup, ToggleButton, ToggleButtonGroup } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import ReactMarkdown from 'react-markdown';

const Meetings = () => {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [pendingPolls, setPendingPolls] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [selectedPoll, setSelectedPoll] = useState<any>(null);
  const [selectedMeetingToFinalize, setSelectedMeetingToFinalize] = useState<any>(null);
  const [finalSlot, setFinalSlot] = useState('');
  const [votes, setVotes] = useState<Record<string, string>>({});
  
  // AI State
  const [showAIModal, setShowAIModal] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [draftType, setDraftType] = useState('AGENDA');
  const [generatedDraft, setGeneratedDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const { user } = useContext(AuthContext);
  const location = useLocation();

  // Form states
  const [formData, setFormData] = useState({
    projectId: '',
    activityId: '',
    title: '',
    description: '',
    durationMin: 30,
    slot1: '',
    slot2: '',
    slot3: ''
  });

  const fetchData = async () => {
    try {
      const [meetingsRes, pollsRes, projectsRes] = await Promise.all([
        axios.get('http://localhost:5001/api/meetings'),
        axios.get('http://localhost:5001/api/meetings/polls/pending'),
        axios.get('http://localhost:5001/api/projects')
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

  useEffect(() => {
    if (location.state && location.state.openScheduleModal) {
      setFormData(prev => ({
        ...prev,
        projectId: location.state.projectId || '',
        activityId: location.state.activityId || '',
        title: location.state.activityTitle ? `Meeting for: ${location.state.activityTitle}` : ''
      }));
      setShowScheduleModal(true);
      
      // Clear state so a refresh doesn't pop it up again
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const proposedSlots = [formData.slot1, formData.slot2, formData.slot3].filter(s => s);
    
    const project = projects.find(p => p.id === formData.projectId);
    const participantIds = project ? project.members.map((m: any) => m.userId) : [];

    try {
      await axios.post('http://localhost:5001/api/meetings/poll', {
        ...formData,
        proposedSlots,
        participantIds
      });
      setShowScheduleModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const [isSuggesting, setIsSuggesting] = useState(false);
  const handleAutoSuggest = async () => {
    if (!formData.projectId) return alert("Please select a project first to get the team members!");
    const project = projects.find(p => p.id === formData.projectId);
    const participantIds = project ? project.members.map((m: any) => m.userId) : [];
    
    const startDate = new Date();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    
    setIsSuggesting(true);
    try {
      const res = await axios.post('http://localhost:5001/api/calendar/suggest', {
        participantIds,
        durationMin: formData.durationMin,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      
      const slots = res.data.slots;
      setFormData({
        ...formData,
        slot1: slots[0] ? slots[0].slice(0, 16) : '',
        slot2: slots[1] ? slots[1].slice(0, 16) : '',
        slot3: slots[2] ? slots[2].slice(0, 16) : ''
      });
    } catch (err) {
      console.error('Failed to auto suggest', err);
      alert('Could not auto-suggest. Have team members connected their Google Calendars?');
    }
    setIsSuggesting(false);
  };

  const handleOpenVote = (poll: any) => {
    setSelectedPoll(poll);
    setVotes({});
    setShowVoteModal(true);
  };

  const handleSubmitVote = async () => {
    const voteArray = Object.keys(votes).map(slot => ({
      selectedSlot: slot,
      availability: votes[slot]
    }));

    try {
      await axios.post(`http://localhost:5001/api/meetings/poll/${selectedPoll.id}/vote`, { votes: voteArray });
      setShowVoteModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
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
      await axios.post(`http://localhost:5001/api/meetings/${selectedMeetingToFinalize.id}/finalize`, { finalStartDate: finalSlot });
      setShowFinalizeModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setGeneratedDraft('');
    try {
      const res = await axios.post('http://localhost:5001/api/ai/generate', {
        meetingId: selectedMeetingId,
        draftType,
        prompt: aiPrompt
      });
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

  return (
    <Container fluid>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Meetings & Polls</h2>
        <Button variant="primary" onClick={() => setShowScheduleModal(true)} className="shadow-sm">
          <i className="bi bi-calendar-plus me-2"></i>Schedule Meeting
        </Button>
      </div>

      <Row>
        <Col md={8}>
          <h5 className="mb-3 text-secondary">Your Meetings</h5>
          {meetings.length === 0 ? (
            <Card className="bg-light border-0 shadow-sm"><Card.Body className="text-center text-muted p-5">No meetings found. Schedule one to get started!</Card.Body></Card>
          ) : (
            meetings.map(meeting => (
              <Card key={meeting.id} className="mb-3 border-0 shadow-sm custom-hover-card">
                <Card.Body className="d-flex justify-content-between align-items-center">
                  <div>
                    <Card.Title className="mb-1">{meeting.title}</Card.Title>
                    <Card.Subtitle className="mb-2 text-primary small"><i className="bi bi-folder2-open me-1"></i>{meeting.project.name}</Card.Subtitle>
                    <Card.Text className="text-muted mb-0">
                      <i className="bi bi-clock me-1"></i>
                      {meeting.startDate ? new Date(meeting.startDate).toLocaleString() : 'Time pending (Poll active)'} • {meeting.durationMin} mins
                    </Card.Text>
                  </div>
                  <div className="text-end">
                    <Badge bg={meeting.status === 'CONFIRMED' ? 'success' : 'warning'} className="mb-2 px-3 py-2 rounded-pill">
                      {meeting.status}
                    </Badge>
                    <div className="d-flex gap-2 justify-content-end">
                      {meeting.status === 'CONFIRMED' && (
                        <Button variant="outline-primary" size="sm" onClick={() => openAIModal(meeting.id)}>
                          <i className="bi bi-magic me-1"></i> AI Assistant
                        </Button>
                      )}
                      {meeting.status === 'DRAFT' && meeting.organizerId === user?.id && meeting.poll && (
                        <Button variant="success" size="sm" onClick={() => handleOpenFinalize(meeting)}>
                          <i className="bi bi-check-circle me-1"></i> Finalize Time
                        </Button>
                      )}
                    </div>
                  </div>
                </Card.Body>
              </Card>
            ))
          )}
        </Col>

        <Col md={4}>
          <h5 className="mb-3 text-secondary">Action Required</h5>
          {pendingPolls.length === 0 ? (
            <Card className="bg-light border-0 shadow-sm"><Card.Body className="text-center text-muted p-4">You're all caught up!</Card.Body></Card>
          ) : (
            pendingPolls.map(poll => (
              <Card key={poll.id} className="mb-3 border-0 border-start border-warning border-4 shadow-sm custom-hover-card">
                <Card.Body>
                  <h6 className="fw-bold">{poll.meeting.title}</h6>
                  <small className="text-primary d-block mb-3"><i className="bi bi-folder2-open me-1"></i>{poll.meeting.project.name}</small>
                  <Button variant="warning" size="sm" className="w-100 text-dark fw-semibold" onClick={() => handleOpenVote(poll)}>
                    <i className="bi bi-ui-radios me-1"></i> Vote on Proposed Times
                  </Button>
                </Card.Body>
              </Card>
            ))
          )}
        </Col>
      </Row>

      {/* AI Assistant Modal */}
      <Modal show={showAIModal} onHide={() => setShowAIModal(false)} size="lg" centered>
        <Modal.Header closeButton className="bg-light border-0 pb-3">
          <Modal.Title className="fw-bold"><i className="bi bi-magic text-primary me-2"></i>Gemini AI Assistant</Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-4">
          <Form onSubmit={handleGenerateAI}>
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Draft Type</Form.Label>
                  <Form.Select value={draftType} onChange={e => setDraftType(e.target.value)} className="shadow-none">
                    <option value="AGENDA">Meeting Agenda</option>
                    <option value="INVITATION">Email Invitation</option>
                    <option value="SUMMARY">Meeting Summary</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={8}>
                <Form.Group className="mb-3">
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
                {isGenerating ? <><span className="spinner-border spinner-border-sm me-2"></span>Generating...</> : <><i className="bi bi-stars me-1"></i>Generate</>}
              </Button>
            </div>
          </Form>

          {generatedDraft && (
            <div className="mt-4 p-4 bg-white rounded shadow-sm border">
              <h6 className="text-primary fw-bold mb-3 border-bottom pb-2">Generated {draftType}</h6>
              <div className="markdown-body text-dark" style={{fontSize: '0.95rem'}}>
                <ReactMarkdown>{generatedDraft}</ReactMarkdown>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Finalize Meeting Modal */}
      {selectedMeetingToFinalize && (
        <Modal show={showFinalizeModal} onHide={() => setShowFinalizeModal(false)} centered>
          <Modal.Header closeButton className="bg-light border-0">
            <Modal.Title className="fw-bold">Finalize Meeting Time</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="text-muted">Select the winning time slot to officially lock in <strong>{selectedMeetingToFinalize.title}</strong>.</p>
            <Form.Group>
              {selectedMeetingToFinalize.poll.options.map((slot: string, idx: number) => (
                <div key={idx} className="mb-2 p-3 bg-light rounded border d-flex justify-content-between align-items-center cursor-pointer" onClick={() => setFinalSlot(slot)} style={{cursor: 'pointer'}}>
                  <Form.Check 
                    type="radio" 
                    id={`finalize-${idx}`} 
                    name="finalizeSlot" 
                    label={new Date(slot).toLocaleString()} 
                    checked={finalSlot === slot}
                    onChange={() => setFinalSlot(slot)}
                    className="fw-semibold"
                  />
                </div>
              ))}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-0 bg-light">
            <Button variant="secondary" onClick={() => setShowFinalizeModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="success" onClick={handleFinalize} disabled={!finalSlot} className="rounded-pill px-4 shadow-sm">Confirm Meeting</Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Schedule Meeting Modal */}
      <Modal show={showScheduleModal} onHide={() => setShowScheduleModal(false)} centered>
        <Form onSubmit={handleCreatePoll}>
          <Modal.Header closeButton className="bg-light border-0">
            <Modal.Title className="fw-bold">Schedule a Meeting</Modal.Title>
          </Modal.Header>
          <Modal.Body>
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold text-muted small text-uppercase">Project</Form.Label>
                <Form.Select required value={formData.projectId} onChange={e => setFormData({...formData, projectId: e.target.value, activityId: ''})} className="shadow-none">
                  <option value="">Select a project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Form.Select>
              </Form.Group>
              
              {formData.projectId && projects.find(p => p.id === formData.projectId)?.activities?.length > 0 && (
                <Form.Group className="mb-3">
                  <Form.Label className="fw-semibold text-muted small text-uppercase">Activity (Optional)</Form.Label>
                  <Form.Select value={formData.activityId} onChange={e => setFormData({...formData, activityId: e.target.value})} className="shadow-none">
                    <option value="">None</option>
                    {projects.find(p => p.id === formData.projectId)?.activities.map((act: any) => (
                      <option key={act.id} value={act.id}>{act.title}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              )}

              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold text-muted small text-uppercase">Meeting Title</Form.Label>
              <Form.Control type="text" required className="shadow-none" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold text-muted small text-uppercase">Duration (Minutes)</Form.Label>
              <Form.Control type="number" required className="shadow-none" value={formData.durationMin} onChange={e => setFormData({...formData, durationMin: parseInt(e.target.value)})} />
            </Form.Group>
            
            <h6 className="fw-bold text-primary border-bottom pb-2 mb-3 d-flex justify-content-between align-items-center">
              Propose Time Slots
              <Button variant="outline-primary" size="sm" onClick={handleAutoSuggest} disabled={isSuggesting}>
                {isSuggesting ? 'Analyzing Calendars...' : <><i className="bi bi-magic me-1"></i> Auto-Suggest Slots</>}
              </Button>
            </h6>
            <p className="small text-muted mb-3">Suggest up to 3 times for your team to vote on.</p>
            <Form.Group className="mb-2">
              <Form.Control type="datetime-local" required className="shadow-none border-primary border-opacity-50" value={formData.slot1} onChange={e => setFormData({...formData, slot1: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Control type="datetime-local" className="shadow-none" value={formData.slot2} onChange={e => setFormData({...formData, slot2: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Control type="datetime-local" className="shadow-none" value={formData.slot3} onChange={e => setFormData({...formData, slot3: e.target.value})} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-0 bg-light">
            <Button variant="secondary" onClick={() => setShowScheduleModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="primary" type="submit" className="rounded-pill px-4 shadow-sm">Send Poll</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Voting Modal */}
      {selectedPoll && (
        <Modal show={showVoteModal} onHide={() => setShowVoteModal(false)} centered>
          <Modal.Header closeButton className="bg-light border-0">
            <Modal.Title className="fw-bold">Vote on Meeting Time</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <h5 className="fw-bold text-primary">{selectedPoll.meeting.title}</h5>
            <p className="text-muted small">{selectedPoll.meeting.description}</p>
            <div className="alert alert-info py-2 small mb-4">
              <i className="bi bi-info-circle me-2"></i>
              Please select your availability for the proposed times below.
            </div>
            
            {selectedPoll.options.map((slot: string, idx: number) => (
              <div key={idx} className="mb-3 p-3 bg-white border rounded shadow-sm">
                <div className="fw-bold mb-3 d-flex align-items-center">
                  <i className="bi bi-calendar-event text-primary me-2"></i>
                  {new Date(slot).toLocaleString()}
                </div>
                <ToggleButtonGroup type="radio" name={`vote-${idx}`} className="w-100 d-flex" value={votes[slot]} onChange={(val) => setVotes({...votes, [slot]: val})}>
                  <ToggleButton id={`yes-${idx}`} value="YES" variant={votes[slot] === 'YES' ? 'success' : 'outline-success'} className="flex-fill fw-semibold">Yes</ToggleButton>
                  <ToggleButton id={`ifneed-${idx}`} value="IF_NECESSARY" variant={votes[slot] === 'IF_NECESSARY' ? 'warning' : 'outline-warning'} className="flex-fill fw-semibold">If Needed</ToggleButton>
                  <ToggleButton id={`no-${idx}`} value="NO" variant={votes[slot] === 'NO' ? 'danger' : 'outline-danger'} className="flex-fill fw-semibold">No</ToggleButton>
                </ToggleButtonGroup>
              </div>
            ))}
          </Modal.Body>
          <Modal.Footer className="border-0 bg-light">
            <Button variant="secondary" onClick={() => setShowVoteModal(false)} className="rounded-pill px-4">Cancel</Button>
            <Button variant="primary" onClick={handleSubmitVote} disabled={Object.keys(votes).length !== selectedPoll.options.length} className="rounded-pill px-4 shadow-sm">Submit Votes</Button>
          </Modal.Footer>
        </Modal>
      )}

    </Container>
  );
};

export default Meetings;
