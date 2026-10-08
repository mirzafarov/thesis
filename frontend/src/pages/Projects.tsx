import React, { useEffect, useState, useContext } from 'react';
import { Button, Card, Col, Container, Row, Modal, Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

interface Project {
  id: string;
  name: string;
  description: string;
  _count: {
    activities: number;
    meetings: number;
  };
  members?: { userId: string, role: string }[];
}

const Projects = () => {
  const { user } = useContext(AuthContext);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();

  const fetchProjects = async () => {
    try {
      const res = await axios.get('http://localhost:5001/api/projects');
      setProjects(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://localhost:5001/api/projects', { name, description });
      setShowModal(false);
      setName('');
      setDescription('');
      navigate(`/projects/${res.data.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    try {
      await axios.delete(`http://localhost:5001/api/projects/${projectToDelete}`);
      setShowDeleteModal(false);
      setProjectToDelete(null);
      fetchProjects();
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  return (
    <Container fluid>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Projects</h2>
        <Button onClick={() => setShowModal(true)}>Create Project</Button>
      </div>

      <Row>
          {projects.length === 0 ? (
            <Col><p>No projects found. Create one to get started!</p></Col>
          ) : (
            projects.map(project => {
              const myMembership = project.members?.find((m: any) => m.userId === user?.id);
              const isManager = myMembership?.role === 'MANAGER' || user?.role === 'ADMIN';

              return (
                <Col md={4} key={project.id} className="mb-4">
                  <Card className="h-100 position-relative shadow-sm">
                    {isManager && (
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="position-absolute top-0 end-0 m-2 text-danger text-decoration-none shadow-none p-1" 
                        onClick={() => {
                          setProjectToDelete(project.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="bi bi-trash"></i>
                      </Button>
                    )}
                    <Card.Body>
                      <Card.Title className={isManager ? "pe-4" : ""}>{project.name}</Card.Title>
                      <Card.Text className="text-muted">{project.description || 'No description provided.'}</Card.Text>
                      <div className="d-flex justify-content-between text-muted small mt-3">
                        <span><i className="bi bi-list-task me-1"></i> {project._count?.activities || 0} Activities</span>
                        <span><i className="bi bi-calendar-event me-1"></i> {project._count?.meetings || 0} Meetings</span>
                      </div>
                    </Card.Body>
                    <Card.Footer className="bg-transparent border-0 pb-3 pt-0">
                      <Link to={`/projects/${project.id}`} className="btn btn-outline-primary btn-sm w-100 rounded-pill">
                        View Details
                      </Link>
                    </Card.Footer>
                  </Card>
                </Col>
              );
            })
          )}
      </Row>

      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create New Project</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleCreate}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Project Name</Form.Label>
              <Form.Control type="text" required value={name} onChange={e => setName(e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control as="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit">Create</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Delete Project Modal */}
      <Modal show={showDeleteModal} onHide={() => { setShowDeleteModal(false); setProjectToDelete(null); }} centered>
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Delete Project</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to delete this project? This will permanently delete all associated activities, meetings, and team data. This action cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setProjectToDelete(null); }} className="rounded-pill px-4">
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteProject} className="rounded-pill px-4 shadow-sm">
            Delete Project
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Projects;
