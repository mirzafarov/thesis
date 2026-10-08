import React, { useContext, useState } from 'react';
import { Container, Card, Button, Modal } from 'react-bootstrap';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const Profile = () => {
  const { user, logout } = useContext(AuthContext);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleExportData = async () => {
    try {
      const res = await axios.get('http://localhost:5001/api/auth/me/export');
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', 'my_data.json');
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (err) {
      console.error(err);
      alert('Failed to export data');
    }
  };

  const confirmDeleteAccount = async () => {
    try {
      await axios.delete('http://localhost:5001/api/auth/me');
      logout();
    } catch (err) {
      console.error(err);
      alert('Failed to delete account');
    }
  };

  return (
    <Container fluid className="p-2">
      <h2 className="mb-4 saas-heading">Profile Settings</h2>
      <Card className="mb-4 saas-card">
        <Card.Header className="bg-transparent py-3 border-bottom-0"><h5 className="mb-0 saas-heading">GDPR Compliance</h5></Card.Header>
        <Card.Body>
          <p style={{ color: 'var(--text-muted)'}}>Manage your personal data in accordance with the General Data Protection Regulation (GDPR).</p>
          <div className="d-flex gap-3 mt-4">
            <Button className="saas-btn-outline-primary" onClick={handleExportData}><i className="bi bi-download me-2"></i> Export My Data (JSON)</Button>
            <Button className="saas-btn-outline-danger" onClick={() => setShowDeleteModal(true)}><i className="bi bi-trash me-2"></i> Delete Account (Right to be Forgotten)</Button>
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-4 saas-card">
        <Card.Header className="bg-transparent py-3 border-bottom"><h5 className="mb-0 saas-heading">Session Control</h5></Card.Header>
        <Card.Body>
          <p style={{ color: 'var(--text-muted)'}}>Manage your active sessions across devices.</p>
          <div className="border rounded p-3 mb-3 d-flex justify-content-between align-items-center" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="fw-bold" style={{ color: 'var(--text-primary)'}}>Current Session <span className="badge bg-success ms-2">Active</span></div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>IP Address: 127.0.0.1 • Role: {user?.role}</div>
            </div>
            <Button className="saas-btn-outline-danger btn-sm" onClick={logout}><i className="bi bi-x-circle me-1"></i> End Session</Button>
          </div>
        </Card.Body>
      </Card>

      {/* Delete Account Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Delete Account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>WARNING: Are you sure you want to permanently delete your account?</p>
          <p className="text-muted small">This action cannot be undone and complies with GDPR Right to be Forgotten. All your personal data will be erased.</p>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} className="rounded-pill px-4">
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteAccount} className="rounded-pill px-4 shadow-sm">
            Confirm Deletion
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Profile;
