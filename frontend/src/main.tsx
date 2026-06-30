import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Theme: light by default (clean professional); honor a saved preference.
if (localStorage.getItem('loopscore-theme') === 'dark') {
  document.documentElement.classList.add('dark');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
