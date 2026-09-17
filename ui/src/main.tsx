import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installPerfProbe } from './utils/perf-metrics';
import './theme/reset.css';
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/components.css';
import './theme/responsive.css';

// PERF-06: expose aggregate-only runtime metrics to automated checks.
installPerfProbe();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
