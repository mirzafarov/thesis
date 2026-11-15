import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './index.css';
import axios from 'axios';
import { applyConsent } from './lib/consent';

// Load optional external content (Google font) only if the visitor allowed it
applyConsent();

// All API calls use paths like '/api/projects'; the server address is set once here.
// Override it with VITE_API_URL in frontend/.env (e.g. for a deployed backend).
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

// When the server cannot be reached at all (backend stopped, wrong address), there is no response to read an error
// from. Give every page the same clear message instead of a generic "failed".
axios.interceptors.response.use(undefined, error => {
  if (axios.isAxiosError(error) && !error.response && error.code !== 'ERR_CANCELED') {
    error.response = {
      status: 0, statusText: '', headers: {}, config: error.config!,
      data: { error: `Cannot reach the Safe Zone server (${axios.defaults.baseURL}). Make sure the backend is running and open the app at http://localhost:5173, then try again.` },
    };
  }
  return Promise.reject(error);
});

function fallbackRender({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" style={{ padding: '20px', color: 'red' }}>
      <p>Something went wrong:</p>
      <button className="btn btn-sm btn-outline-danger mb-2" onClick={resetErrorBoundary}>Try again</button>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackRender={fallbackRender}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
