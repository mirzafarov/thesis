import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from 'react-error-boundary';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './index.css';
import axios from 'axios';

// All API calls use paths like '/api/projects'; the server address is set once here.
// Override it with VITE_API_URL in frontend/.env (e.g. for a deployed backend).
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

function fallbackRender({ error, resetErrorBoundary }: any) {
  return (
    <div role="alert" style={{ padding: '20px', color: 'red' }}>
      <p>Something went wrong:</p>
      <button className="btn btn-sm btn-outline-danger mb-2" onClick={resetErrorBoundary}>Try again</button>
      <pre>{error.message}</pre>
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
