import React, { useContext } from 'react';
import { Nav } from 'react-bootstrap';
import { NavLink, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

interface SidebarProps {
  onNavClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onNavClick }) => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="saas-sidebar h-100 p-3 p-md-4 d-flex flex-column" style={{ width: '100%', position: 'sticky', top: 0 }}>
      {/* Hide the logo header on mobile since the Offcanvas header handles it */}
      <div className="mb-4 d-none d-md-flex align-items-center">
        <div className="text-white rounded p-1 me-2" style={{ backgroundColor: 'var(--primary-blue)'}}>
          <i className="bi bi-hexagon-fill fs-4"></i>
        </div>
        <h4 className="mb-0 fw-bold text-white">Safe <span style={{ color: 'var(--primary-blue)'}}>Zone</span></h4>
      </div>
      
      <Nav className="flex-column mb-auto mt-md-0 mt-2 saas-sidebar-nav">
        {user?.role !== 'ADMIN' && (
          <>
            <NavLink to="/dashboard" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
              <i className="bi bi-grid-1x2 fs-5 me-3"></i> Dashboard
            </NavLink>
            <NavLink to="/projects" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
              <i className="bi bi-folder fs-5 me-3"></i> Projects
            </NavLink>
            <NavLink to="/meetings" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
              <i className="bi bi-calendar-event fs-5 me-3"></i> Meetings
            </NavLink>
          </>
        )}
        
        {user?.role === 'ADMIN' && (
          <>
            <NavLink to="/admin/logs" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
              <i className="bi bi-shield-lock fs-5 me-3"></i> System Logs
            </NavLink>
            <NavLink to="/admin/users" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
              <i className="bi bi-people fs-5 me-3"></i> User Management
            </NavLink>
          </>
        )}

        <NavLink to="/profile" className="nav-link mb-2 rounded-3 py-3 px-4 d-flex align-items-center fw-semibold" style={{ fontSize: '16px' }} onClick={onNavClick}>
          <i className="bi bi-person-gear fs-5 me-3"></i> Settings
        </NavLink>
      </Nav>

      <hr className="border-secondary opacity-25 my-4" />
      
      <div className="mt-auto">
        <div className="d-flex align-items-center mb-4 px-2">
          <div className="rounded-circle d-flex align-items-center justify-content-center me-3 border shadow-sm" style={{ backgroundColor: 'var(--sidebar-border)', borderColor: 'var(--sidebar-border)', width: '42px', height: '42px' }}>
            <i className="bi bi-person text-white fs-5"></i>
          </div>
          <div className="text-truncate">
            <div className="fw-bold text-white" style={{ fontSize: '15px' }}>{user?.firstName} {user?.lastName}</div>
            <div style={{ color: 'var(--sidebar-text)', fontSize: '0.8rem', fontWeight: 500 }}>{user?.role}</div>
          </div>
        </div>
        <div className="d-flex flex-column gap-3">
          <button 
            onClick={() => {
              const html = document.documentElement;
              const currentTheme = html.getAttribute('data-theme') || 'light';
              const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
              html.setAttribute('data-theme', newTheme);
              localStorage.setItem('theme', newTheme);
            }} 
            className="btn w-100 rounded-3 shadow-none fw-semibold d-flex align-items-center justify-content-center"
            style={{ border: '1px solid var(--sidebar-border)', color: 'var(--sidebar-text)', backgroundColor: 'transparent', padding: '10px 16px', fontSize: '14px' }}
          >
            <i className="bi bi-moon-stars fs-5 me-2"></i> Toggle Theme
          </button>
          <button 
            onClick={handleLogout} 
            className="btn w-100 rounded-3 shadow-none fw-semibold d-flex align-items-center justify-content-center" 
            style={{ border: '1px solid rgba(239, 68, 68, 0.5)', color: '#f87171', backgroundColor: 'transparent', padding: '10px 16px', fontSize: '14px' }}
          >
            <i className="bi bi-box-arrow-left fs-5 me-2"></i> Logout
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
