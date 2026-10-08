import React, { useEffect, useState, useContext } from 'react';
import { Container, Card, Table, Badge } from 'react-bootstrap';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const AdminLogs = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await axios.get('http://localhost:5001/api/users/admin/logs');
        setLogs(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLogs();
  }, []);

  if (user?.role !== 'ADMIN') {
    return <Container className="mt-5 text-center"><h3>Access Denied: Administrators Only</h3></Container>;
  }

  const formatIP = (ip: string) => {
    if (!ip) return 'Unknown';
    if (ip === '::1' || ip === '127.0.0.1') return '127.0.0.1 (Localhost)';
    if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
    return ip;
  };

  const thStyle = { color: 'var(--text-secondary)', textTransform: 'uppercase' as const, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', padding: '12px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--page-bg)' };
  const tdStyle = { padding: '12px 16px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', backgroundColor: 'transparent' };

  return (
    <Container fluid className="p-2 p-md-4">
      <h2 className="mb-4 saas-heading fw-bold">System Audit Logs</h2>
      <Card className="saas-card overflow-hidden border-0" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0" style={{ backgroundColor: 'var(--surface)' }}>
            <thead>
              <tr>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>IP Address</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={{ transition: 'background-color 0.2s' }}>
                  <td style={tdStyle} className="text-muted" style={{...tdStyle, color: 'var(--text-secondary)'}}>{new Date(log.createdAt).toLocaleString()}</td>
                  <td style={tdStyle} className="fw-semibold" style={{...tdStyle, color: 'var(--text-primary)'}}>{log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}</td>
                  <td style={tdStyle}>
                    <Badge 
                      bg="transparent" 
                      style={log.action === 'LOGIN' 
                        ? { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)', fontWeight: 600, padding: '5px 8px' } 
                        : { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: 600, padding: '5px 8px' }}
                    >
                      {log.action}
                    </Badge>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', backgroundColor: 'var(--page-bg)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                      {formatIP(log.ipAddress)}
                    </span>
                  </td>
                  <td style={tdStyle} style={{...tdStyle, color: 'var(--text-primary)'}}>{log.details}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="text-center py-5 text-muted" style={{ backgroundColor: 'var(--surface)' }}>No logs found.</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default AdminLogs;
