import React, { useEffect, useState, useContext } from 'react';
import { Container, Card, Table, Badge } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const UserManagement = () => {
  const [usersList, setUsersList] = useState<any[]>([]);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('http://localhost:5001/api/users/admin/all');
        setUsersList(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchUsers();
  }, []);

  if (user?.role !== 'ADMIN') {
    return <Container className="mt-5 text-center"><h3>Access Denied</h3></Container>;
  }

  const thStyle = { color: 'var(--text-secondary)', textTransform: 'uppercase' as const, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', padding: '12px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--page-bg)' };
  const tdStyle = { padding: '12px 16px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', backgroundColor: 'transparent' };

  return (
    <Container fluid className="p-2 p-md-4">
      <h2 className="mb-4 saas-heading fw-bold">User Management</h2>
      <Card className="saas-card overflow-hidden border-0" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>System Role</th>
                <th style={thStyle}>Joined Date</th>
              </tr>
            </thead>
            <tbody>
              {usersList.map(u => (
                <tr key={u.id} style={{ transition: 'background-color 0.2s' }}>
                  <td style={{...tdStyle, color: 'var(--text-primary)'}} className="fw-semibold">{u.firstName} {u.lastName}</td>
                  <td style={{...tdStyle, color: 'var(--text-secondary)'}}>{u.email}</td>
                  <td style={tdStyle}>
                    <Badge bg="transparent" style={{ backgroundColor: u.systemRole === 'ADMIN' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(100, 116, 139, 0.15)', color: u.systemRole === 'ADMIN' ? '#60a5fa' : 'var(--text-secondary)', border: u.systemRole === 'ADMIN' ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid rgba(100, 116, 139, 0.3)', fontWeight: 600, padding: '5px 8px' }}>
                      {u.systemRole}
                    </Badge>
                  </td>
                  <td style={{...tdStyle, color: 'var(--text-secondary)'}} className="text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default UserManagement;
