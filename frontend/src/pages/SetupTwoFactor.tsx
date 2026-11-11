import { useContext } from 'react';
import { Button, Card, Container } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import TwoFactorSetup from '../components/security/TwoFactorSetup';

/** Shown right after login to managers and administrators who have not set up two-factor login yet. */
const SetupTwoFactor = () => {
  const { user, updateUser, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  return (
    <Container className="d-flex align-items-center justify-content-center py-5" style={{ minHeight: '100vh' }}>
      <div className="w-100" style={{ maxWidth: '520px' }}>
        <Card>
          <Card.Body className="p-4">
            <h2 className="mb-2"><i className="bi bi-shield-lock me-2 text-primary" aria-hidden="true"></i>Set up two-factor login</h2>
            <p className="text-muted">
              {user?.firstName ? `${user.firstName}, as` : 'As'} a {user?.role === 'ADMIN' ? 'system administrator' : 'project manager'} you need
              a second step when you log in: a code from your phone. This protects your projects even if someone learns your password.
            </p>
            <TwoFactorSetup
              onEnabled={() => {
                updateUser({ mfaSetupRequired: false });
                navigate('/dashboard');
              }}
            />
          </Card.Body>
        </Card>
        <div className="text-center mt-2">
          <Button variant="link" onClick={() => logout()}>Log out and do this later</Button>
        </div>
      </div>
    </Container>
  );
};

export default SetupTwoFactor;
