import React, { useEffect } from 'react';

const OAuthSuccess = () => {
  useEffect(() => {
    localStorage.setItem('oauth_status', Date.now().toString());
    window.close();
  }, []);

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="text-center">
        <h4 className="text-success mb-3"><i className="bi bi-check-circle-fill me-2"></i>Authentication Successful!</h4>
        <p className="text-muted">You can close this window now.</p>
      </div>
    </div>
  );
};

export default OAuthSuccess;

