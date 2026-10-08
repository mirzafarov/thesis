import React, { useState } from 'react';
import { Container, Form, Button, Card, Alert, InputGroup } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import 'react-phone-number-input/style.css';
import PhoneInput from 'react-phone-number-input';

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [gdprConsent, setGdprConsent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const calculateStrength = (pass: string) => {
    let score = 0;
    if (pass.length > 7) score += 25;
    if (pass.match(/[a-z]/)) score += 25;
    if (pass.match(/[A-Z]/)) score += 25;
    if (pass.match(/[0-9]/) || pass.match(/[^A-Za-z0-9]/)) score += 25;
    return score;
  };

  const getStrengthColor = (score: number) => {
    if (score <= 25) return 'danger';
    if (score <= 50) return 'warning';
    if (score <= 75) return 'info';
    return 'success';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      return setError('Passwords do not match.');
    }
    
    // Password Strength Check
    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])(?=.{8,})/;
    if (!strongRegex.test(password)) {
      return setError('Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.');
    }
    
    if (!gdprConsent) {
      return setError('You must agree to the Privacy Policy and GDPR rules to register.');
    }

    setLoading(true);
    try {
      await axios.post('http://localhost:5001/api/auth/register', { 
        firstName, lastName, email, phone, password, gdprConsent
      });
      navigate('/login');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const strengthScore = calculateStrength(password);

  return (
    <Container className="d-flex align-items-center justify-content-center py-5" style={{ minHeight: '100vh' }}>
      <div className="w-100" style={{ maxWidth: '450px' }}>
        <Card className="saas-card border-0 shadow-lg">
          <Card.Body className="p-4 p-md-5">
            <h2 className="text-center mb-4 saas-heading fw-bold">Sign Up</h2>
            {error && <Alert variant="danger">{error}</Alert>}
            <Form onSubmit={handleSubmit}>
              <div className="row">
                <Form.Group id="firstName" className="col-6 mb-3">
                  <Form.Label className="fw-semibold text-secondary small text-uppercase">First Name</Form.Label>
                  <Form.Control type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Form.Group>
                <Form.Group id="lastName" className="col-6 mb-3">
                  <Form.Label className="fw-semibold text-secondary small text-uppercase">Last Name</Form.Label>
                  <Form.Control type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Form.Group>
              </div>
              
              <Form.Group id="email" className="mb-3">
                <Form.Label className="fw-semibold text-secondary small text-uppercase">Email</Form.Label>
                <Form.Control type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Form.Group>

              <Form.Group id="phone" className="mb-3">
                <Form.Label className="fw-semibold text-secondary small text-uppercase">Phone (Optional)</Form.Label>
                <PhoneInput
                  international
                  defaultCountry="US"
                  value={phone}
                  onChange={(val) => setPhone(val || '')}
                  className="PhoneInput"
                />
              </Form.Group>

              <Form.Group id="password" className="mb-3">
                <Form.Label className="fw-semibold text-secondary small text-uppercase">Password</Form.Label>
                <InputGroup>
                  <Form.Control type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button variant="outline-secondary" onClick={() => setShowPassword(!showPassword)} style={{ borderColor: 'var(--border)' }}>
                    <i className={showPassword ? 'bi bi-eye-slash' : 'bi bi-eye'}></i>
                  </Button>
                </InputGroup>
                {password && (
                  <div className="mt-2">
                    <div className="progress" style={{ height: '6px' }}>
                      <div className={`progress-bar bg-${getStrengthColor(strengthScore)}`} role="progressbar" style={{ width: `${strengthScore}%` }}></div>
                    </div>
                    <small className={`text-${getStrengthColor(strengthScore)} d-block mt-1 fw-bold`}>
                      {strengthScore <= 25 && 'Weak'}
                      {strengthScore > 25 && strengthScore <= 50 && 'Fair'}
                      {strengthScore > 50 && strengthScore <= 75 && 'Good'}
                      {strengthScore > 75 && 'Strong'}
                    </small>
                  </div>
                )}
              </Form.Group>

              <Form.Group id="confirmPassword" className="mb-4">
                <Form.Label className="fw-semibold text-secondary small text-uppercase">Confirm Password</Form.Label>
                <InputGroup>
                  <Form.Control type={showConfirmPassword ? 'text' : 'password'} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  <Button variant="outline-secondary" onClick={() => setShowConfirmPassword(!showConfirmPassword)} style={{ borderColor: 'var(--border)' }}>
                    <i className={showConfirmPassword ? 'bi bi-eye-slash' : 'bi bi-eye'}></i>
                  </Button>
                </InputGroup>
              </Form.Group>

              <Form.Group id="gdpr" className="mb-4">
                <Form.Check 
                  type="checkbox" 
                  label="I agree to the Privacy Policy and GDPR data processing rules." 
                  checked={gdprConsent}
                  onChange={(e) => setGdprConsent(e.target.checked)}
                />
              </Form.Group>
              <Button disabled={loading} className="w-100 py-2 fw-bold rounded-3" variant="primary" type="submit">
                Sign Up
              </Button>
            </Form>
          </Card.Body>
        </Card>
        <div className="w-100 text-center mt-3" style={{color: 'var(--text-secondary)'}}>
          Already have an account? <Link to="/login" className="fw-semibold" style={{color: 'var(--primary)'}}>Log In</Link>
        </div>
      </div>
    </Container>
  );
};

export default Register;
