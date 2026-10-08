import React, { useEffect, useState, useContext } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Card, Row, Col, Button, Badge, ListGroup, Form, Modal } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const ProjectDetails = () => {
  const { id } = useParams();
  const { user } = useContext(AuthContext);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<string | null>(null);
  const [activityTitle, setActivityTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [inviteError, setInviteError] = useState('');

  const handleExportPDF = () => {
    import('jspdf').then(({ jsPDF }) => {
      import('jspdf-autotable').then(({ default: autoTable }) => {
        const doc = new jsPDF();
        
        doc.setFontSize(20);
        doc.text(`Project Report: ${project.name}`, 14, 22);
        
        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text(project.description || 'No description provided.', 14, 30);

        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text('Team Members', 14, 45);

        const memberData = project.members.map((m: any) => [
          m.user.firstName + ' ' + m.user.lastName,
          m.user.email,
          m.role
        ]);

        autoTable(doc, {
          startY: 50,
          head: [['Name', 'Email', 'Role']],
          body: memberData,
        });

        const finalY = (doc as any).lastAutoTable.finalY || 50;

        doc.setFontSize(16);
        doc.text('Activities & Milestones', 14, finalY + 15);

        const activityData = project.activities.map((a: any) => [
          a.title,
          a.status,
          a.startDate ? new Date(a.startDate).toLocaleDateString() : 'N/A'
        ]);

        autoTable(doc, {
          startY: finalY + 20,
          head: [['Activity', 'Status', 'Start Date']],
          body: activityData,
        });

        doc.save(`${project.name.replace(/\s+/g, '_')}_Report.pdf`);
      });
    });
  };

  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editProjectData, setEditProjectData] = useState({ name: '', description: '' });
  
  const fetchProject = async () => {
    try {
      const res = await axios.get(`http://localhost:5001/api/projects/${id}`);
      setProject(res.data);
      setEditProjectData({ name: res.data.name, description: res.data.description || '' });
    } catch (err) {
      console.error(err);
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [id]);

  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.put(`http://localhost:5001/api/projects/${id}`, editProjectData);
      setShowEditProjectModal(false);
      fetchProject();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`http://localhost:5001/api/projects/${id}/activities`, {
        title: activityTitle,
        description: 'New activity'
      });
      setActivityTitle('');
      setShowActivityModal(false);
      fetchProject();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearchUsers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (e.target.value.length > 2) {
      try {
        const res = await axios.get(`http://localhost:5001/api/users/search?email=${e.target.value}`);
        // Filter out existing members
        const existingIds = project.members.map((m: any) => m.userId);
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
      await axios.post(`http://localhost:5001/api/projects/${id}/members`, {
        newMemberUserId: userId,
        role: 'EMPLOYEE'
      });
      setSearchQuery('');
      setSearchResults([]);
      setShowInviteModal(false);
      fetchProject();
    } catch (err: any) {
      setInviteError(err.response?.data?.error || 'Failed to invite user');
    }
  };

  const handleUpdateActivityStatus = async (activityId: string, newStatus: string) => {
    try {
      await axios.put(`http://localhost:5001/api/projects/${id}/activities/${activityId}`, { status: newStatus });
      fetchProject();
    } catch (err) {
      console.error(err);
    }
  };

  const confirmDeleteActivity = async () => {
    if (!activityToDelete) return;
    try {
      await axios.delete(`http://localhost:5001/api/projects/${id}/activities/${activityToDelete}`);
      setShowDeleteModal(false);
      setActivityToDelete(null);
      fetchProject();
    } catch (err) {
      console.error(err);
      alert("Failed to delete activity.");
    }
  };

  if (loading) return <Container className="p-4">Loading...</Container>;
  if (!project) return <Container className="p-4">Project not found.</Container>;

  const myMembership = project.members.find((m: any) => m.userId === user?.id);
  const isManager = myMembership?.role === 'MANAGER' || user?.role === 'ADMIN';

  return (
    <Container fluid>
      <div className="mb-4">
        <Link to="/projects" className="text-decoration-none mb-2 d-inline-block">
          <i className="bi bi-arrow-left me-1"></i> Back to Projects
        </Link>
        <div className="d-flex justify-content-between align-items-center">
          <h2>{project.name}</h2>
          <div>
            <Button variant="outline-secondary" className="me-2" onClick={handleExportPDF}>
              <i className="bi bi-file-earmark-pdf-fill me-1"></i> Export PDF
            </Button>
            {isManager && (
              <Button variant="primary" onClick={() => setShowEditProjectModal(true)}>Edit Project</Button>
            )}
          </div>
        </div>
        <p className="text-muted">{project.description}</p>
      </div>

      <Row>
        <Col md={8}>
          <Card className="mb-4 shadow-sm border-0">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center py-3 border-bottom-0">
              <h5 className="mb-0 fw-bold">Activities & Milestones</h5>
              {isManager && (
                <Button variant="outline-primary" size="sm" onClick={() => setShowActivityModal(true)} className="rounded-pill">
                  <i className="bi bi-plus-lg me-1"></i> Add Activity
                </Button>
              )}
            </Card.Header>
            <ListGroup variant="flush">
              {project.activities.length === 0 ? (
                <ListGroup.Item className="p-4 text-center text-muted border-0">No activities found.</ListGroup.Item>
              ) : (
                project.activities.map((act: any) => (
                  <ListGroup.Item key={act.id} className="d-flex justify-content-between align-items-center p-3">
                    <div>
                      <h6 className="mb-1">{act.title}</h6>
                      <small className="text-muted d-block">{act.description}</small>
                    </div>
                    <div className="d-flex align-items-center">
                      <Form.Select 
                        size="sm" 
                        value={act.status} 
                        onChange={(e) => handleUpdateActivityStatus(act.id, e.target.value)}
                        disabled={!isManager}
                        className={`me-2 rounded-pill shadow-none border-${act.status === 'COMPLETED' ? 'success' : act.status === 'IN_PROGRESS' ? 'warning' : 'secondary'}`}
                        style={{width: '140px', fontSize: '0.8rem', fontWeight: 'bold'}}
                      >
                        <option value="PENDING">Pending</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                      </Form.Select>
                        <Link 
                          to="/meetings" 
                          state={{ 
                            openScheduleModal: true, 
                            projectId: project.id, 
                            activityId: act.id, 
                            activityTitle: act.title 
                          }} 
                          className="btn btn-light btn-sm rounded-pill border me-2" 
                          title="Schedule Meeting for this activity"
                        >
                          <i className="bi bi-calendar-plus"></i>
                        </Link>
                        {isManager && (
                          <Button 
                            variant="outline-danger" 
                            size="sm" 
                            className="rounded-pill" 
                            title="Delete Activity"
                            onClick={() => {
                              setActivityToDelete(act.id);
                              setShowDeleteModal(true);
                            }}
                          >
                            <i className="bi bi-trash"></i>
                          </Button>
                        )}
                      </div>
                  </ListGroup.Item>
                ))
              )}
            </ListGroup>
          </Card>
        </Col>
        
        <Col md={4}>
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-white d-flex justify-content-between align-items-center py-3 border-bottom-0">
              <h5 className="mb-0 fw-bold">Team Members</h5>
              {isManager && (
                <Button variant="outline-primary" size="sm" onClick={() => setShowInviteModal(true)} className="rounded-pill">
                  <i className="bi bi-person-plus-fill me-1"></i> Invite
                </Button>
              )}
            </Card.Header>
            <ListGroup variant="flush">
              {project.members.map((member: any) => (
                <ListGroup.Item key={member.id} className="d-flex justify-content-between align-items-center py-3 border-light">
                  <div className="d-flex align-items-center">
                    <div className="bg-light rounded-circle d-flex align-items-center justify-content-center me-3" style={{width: '40px', height: '40px'}}>
                      <i className="bi bi-person text-secondary fs-5"></i>
                    </div>
                    <div>
                      <strong className="d-block text-dark">{member.user.firstName} {member.user.lastName}</strong>
                      <small className="text-muted text-uppercase" style={{fontSize: '0.7rem'}}>{member.role} • {member.user.email}</small>
                    </div>
                  </div>
                  {isManager && member.role !== 'MANAGER' && (
                    <Button 
                      variant="light" 
                      size="sm" 
                      className="text-danger border-0" 
                      title="Remove member"
                      onClick={async () => {
                        try {
                          await axios.delete(`http://localhost:5001/api/projects/${id}/members/${member.user.id}`);
                          fetchProject();
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      <i className="bi bi-trash"></i>
                    </Button>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </Card>
        </Col>
      </Row>

      {/* Edit Project Modal */}
      <Modal show={showEditProjectModal} onHide={() => setShowEditProjectModal(false)}>
        <Form onSubmit={handleEditProject}>
          <Modal.Header closeButton>
            <Modal.Title>Edit Project</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Project Name</Form.Label>
              <Form.Control 
                type="text" 
                required 
                value={editProjectData.name} 
                onChange={e => setEditProjectData({...editProjectData, name: e.target.value})} 
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={3} 
                value={editProjectData.description} 
                onChange={e => setEditProjectData({...editProjectData, description: e.target.value})} 
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowEditProjectModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Save Changes</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Activity Modal */}
      <Modal show={showActivityModal} onHide={() => setShowActivityModal(false)}>
        <Form onSubmit={handleAddActivity}>
          <Modal.Header closeButton>
            <Modal.Title>Add New Activity</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group>
              <Form.Label>Activity Title</Form.Label>
              <Form.Control type="text" required value={activityTitle} onChange={e => setActivityTitle(e.target.value)} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowActivityModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Save Activity</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Invite Member Modal */}
      <Modal show={showInviteModal} onHide={() => setShowInviteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Invite Team Member</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {inviteError && <div className="alert alert-danger">{inviteError}</div>}
          <Form.Group className="mb-3">
            <Form.Label>Search by Email</Form.Label>
            <Form.Control 
              type="text" 
              placeholder="e.g. john@example.com" 
              value={searchQuery} 
              onChange={handleSearchUsers} 
            />
          </Form.Group>
          
          {searchResults.length > 0 && (
            <ListGroup>
              {searchResults.map(user => (
                <ListGroup.Item key={user.id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <strong>{user.firstName} {user.lastName}</strong><br/>
                    <small className="text-muted">{user.email}</small>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => handleInvite(user.id)}>
                    Invite
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
          {searchQuery.length > 2 && searchResults.length === 0 && (
            <p className="text-muted mt-2">No users found matching that email.</p>
          )}
        </Modal.Body>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => { setShowDeleteModal(false); setActivityToDelete(null); }} centered>
        <Modal.Header closeButton>
          <Modal.Title className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Delete Activity</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to delete this activity? This action cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setActivityToDelete(null); }}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteActivity}>
            Delete Activity
          </Button>
        </Modal.Footer>
      </Modal>

    </Container>
  );
};

export default ProjectDetails;
