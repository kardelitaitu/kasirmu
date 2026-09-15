import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installPerfProbe } from './utils/perf-metrics';
import './frontend/themes/reset.css';
import './frontend/themes/fonts.css';
import './frontend/themes/tokens.css';
import './frontend/themes/components.css';
import './frontend/themes/responsive.css';

// PERF-06: expose aggregate-only runtime metrics to automated checks.
installPerfProbe();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
