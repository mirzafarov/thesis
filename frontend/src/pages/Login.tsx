import { useState, useContext } from 'react';
import { Container, Form, Button, Card, Alert } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setNeedsVerification(false);
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      login(response.data.token, response.data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
      setNeedsVerification(err.response?.data?.code === 'EMAIL_NOT_VERIFIED');
    }
  };

  const resendVerification = async () => {
    try {
      const res = await axios.post('/api/auth/resend-verification', { email });
      setError('');
      setNeedsVerification(false);
      setInfo(res.data.message);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not send the email. Please try again later.');
    }
  };

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div className="w-100" style={{ maxWidth: '400px' }}>
        <Card>
          <Card.Body>
            <h2 className="text-center mb-4">Log In</h2>
            {error && (
              <Alert variant="danger">
                {error}
                {needsVerification && (
                  <div className="mt-2">
                    <Button variant="outline-danger" size="sm" onClick={resendVerification}>Send the confirmation email again</Button>
                  </div>
                )}
              </Alert>
            )}
            {info && <Alert variant="success">{info}</Alert>}
            <Form onSubmit={handleSubmit}>
              <Form.Group controlId="email" className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Form.Group>
              <Form.Group controlId="password" className="mb-2">
                <Form.Label>Password</Form.Label>
                <Form.Control type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Form.Group>
              <div className="text-end mb-4">
                <Link to="/forgot-password" className="small">Forgot password?</Link>
              </div>
              <Button className="w-100" type="submit">
                Log In
              </Button>
            </Form>
          </Card.Body>
        </Card>
        <div className="w-100 text-center mt-2">
          Need an account? <Link to="/register">Sign Up</Link>
        </div>
      </div>
    </Container>
  );
};

export default Login;
