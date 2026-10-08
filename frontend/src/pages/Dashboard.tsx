import { useEffect, useState, useContext } from 'react';
import { Card, Row, Col, Alert, Badge, Button } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const Dashboard = () => {
  const [backendStatus, setBackendStatus] = useState<string>('Checking...');
  const [stats, setStats] = useState({ projects: 0, upcomingMeetings: 0 });
  const [pendingPolls, setPendingPolls] = useState<any[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<{connected: boolean, email?: string}>({connected: false});
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      navigate('/admin/logs');
    }
  }, [user, navigate]);

  const fetchDashboardData = () => {
    if (user) {
      Promise.all([
        axios.get('http://localhost:5001/api/projects'),
        axios.get('http://localhost:5001/api/meetings'),
        axios.get('http://localhost:5001/api/meetings/polls/pending'),
        axios.get('http://localhost:5001/api/calendar/status')
      ]).then(([projectsRes, meetingsRes, pollsRes, calRes]) => {
        setStats({
          projects: projectsRes.data.length,
          upcomingMeetings: meetingsRes.data.filter((m: any) => m.status === 'CONFIRMED').length
        });
        setPendingPolls(pollsRes.data);
        setCalendarStatus(calRes.data);
      }).catch(console.error);
    }
  };

  useEffect(() => {
    axios.get('http://localhost:5001/api/health')
      .then(res => setBackendStatus(`Connected: ${res.data.message}`))
      .catch(err => setBackendStatus('Disconnected: Could not reach the backend API'));

    fetchDashboardData();

    const handleFocus = () => fetchDashboardData();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'oauth_status') {
        fetchDashboardData();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorage);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user]);

  const handleConnectCalendar = async () => {
    try {
      const res = await axios.get('http://localhost:5001/api/calendar/google/auth');
      window.open(res.data.url, 'googleAuth', 'width=500,height=600');
    } catch (err) {
      console.error('Failed to get auth URL', err);
    }
  };

  const handleDisconnectCalendar = async () => {
    try {
      await axios.delete('http://localhost:5001/api/calendar/disconnect');
      fetchDashboardData();
    } catch (err) {
      console.error('Failed to disconnect calendar', err);
    }
  };

  return (
    <div>
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-4 gap-3">
        <h2 className="mb-0 fw-bold saas-heading">Dashboard</h2>
        {calendarStatus.connected ? (
          <div className="d-flex align-items-center gap-2">
            <Badge bg="success" className="p-2 fs-6"><i className="bi bi-google me-1"></i> Connected as {calendarStatus.email}</Badge>
            <Button variant="outline-danger" size="sm" onClick={handleDisconnectCalendar} title="Disconnect Calendar">
              <i className="bi bi-box-arrow-right"></i>
            </Button>
          </div>
        ) : (
          <Button 
            onClick={handleConnectCalendar}
            className="d-inline-flex align-items-center justify-content-center shadow-sm"
            style={{ 
              backgroundColor: '#ffffff', 
              color: '#1f2937', 
              border: '1px solid #e2e8f0',
              padding: '10px 16px',
              borderRadius: '8px',
              fontWeight: 600,
              transition: 'background-color 0.2s ease',
              flexShrink: 0
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" className="me-2">
              <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
              <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
              <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
              <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
            </svg>
            Connect Google Calendar
          </Button>
        )}
      </div>
      
      <Alert variant={backendStatus.startsWith('Connected') ? 'success' : 'warning'}>
        <strong>API Status: </strong> {backendStatus}
      </Alert>

      <Row>
        <Col md={4} className="mb-3">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body>
              <Card.Title className="text-primary"><i className="bi bi-calendar-check me-2"></i>Upcoming Meetings</Card.Title>
              <Card.Text className="display-4">{stats.upcomingMeetings}</Card.Text>
              <Link to="/meetings" className="text-decoration-none">View Schedule &rarr;</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body>
              <Card.Title className="text-success"><i className="bi bi-folder me-2"></i>Active Projects</Card.Title>
              <Card.Text className="display-4">{stats.projects}</Card.Text>
              <Link to="/projects" className="text-decoration-none">View Projects &rarr;</Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body>
              <Card.Title className="text-warning"><i className="bi bi-ui-radios me-2"></i>Pending Polls</Card.Title>
              <Card.Text className="display-4">{pendingPolls.length}</Card.Text>
              {pendingPolls.length > 0 && <small className="text-muted d-block mb-2">Requires your vote!</small>}
              <Link to="/meetings" className="text-decoration-none">Vote Now &rarr;</Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {pendingPolls.length > 0 && (
        <Row className="mt-4">
          <Col md={12}>
            <h4>Needs Your Attention</h4>
            {pendingPolls.map(poll => (
              <Card key={poll.id} className="mb-2 border-start border-4 border-warning shadow-sm">
                <Card.Body className="d-flex justify-content-between align-items-center">
                  <div>
                    <h6 className="mb-0">{poll.meeting.title}</h6>
                    <small className="text-muted">Project: {poll.meeting.project.name}</small>
                  </div>
                  <Link to="/meetings" className="btn btn-warning btn-sm text-white">Vote on times</Link>
                </Card.Body>
              </Card>
            ))}
          </Col>
        </Row>
      )}
    </div>
  );
};

export default Dashboard;
