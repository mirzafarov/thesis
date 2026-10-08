import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Offcanvas, Button } from 'react-bootstrap';

const Layout = () => {
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  return (
    <div className="vh-100 d-flex flex-column flex-md-row overflow-hidden" style={{ backgroundColor: 'var(--page-bg)' }}>
      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="d-none d-md-block h-100" style={{ width: '260px', flexShrink: 0 }}>
        <Sidebar />
      </div>

      {/* Mobile Header (hidden on desktop) */}
      <div className="d-md-none border-bottom shadow-sm p-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="d-flex align-items-center">
          <div className="text-white rounded p-1 me-2 d-flex align-items-center justify-content-center" style={{width: '30px', height: '30px', backgroundColor: 'var(--primary)'}}>
            <i className="bi bi-hexagon-fill"></i>
          </div>
          <h5 className="mb-0 fw-bold" style={{ color: 'var(--text-primary)'}}>Safe <span style={{ color: 'var(--primary)'}}>Zone</span></h5>
        </div>
        <Button variant="outline-secondary" size="sm" onClick={() => setShowMobileMenu(true)} className="border shadow-none">
          <i className="bi bi-list fs-4"></i>
        </Button>
      </div>

      {/* Mobile Offcanvas Sidebar */}
      <Offcanvas 
        show={showMobileMenu} 
        onHide={() => setShowMobileMenu(false)} 
        placement="start" 
        style={{ width: '280px', maxWidth: '80vw', borderRight: 'none', backgroundColor: '#0f172a', boxShadow: '5px 0 25px rgba(0,0,0,0.5)' }}
      >
        <Offcanvas.Header closeButton closeVariant="white" style={{ borderBottom: '1px solid #1e293b', backgroundColor: '#0f172a', padding: '1rem 1.25rem' }}>
          <Offcanvas.Title className="fw-bold" style={{ color: '#f8fafc' }}>Menu</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-0 overflow-hidden d-flex flex-column" style={{ height: 'calc(100dvh - 69px)' }}>
          <Sidebar onNavClick={() => setShowMobileMenu(false)} />
        </Offcanvas.Body>
      </Offcanvas>

      {/* Main Content Area */}
      <div className="flex-grow-1 p-3 p-md-4 overflow-auto w-100">
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
