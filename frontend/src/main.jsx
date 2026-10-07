import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// ฟอนต์ฝังในเว็บ (ไม่พึ่ง Google Fonts — ใช้ได้แม้เครือข่าย รพ. บล็อก)
import '@fontsource/anuphan/thai-500.css';
import '@fontsource/anuphan/thai-600.css';
import '@fontsource/anuphan/latin-500.css';
import '@fontsource/anuphan/latin-600.css';
import '@fontsource/sarabun/thai-400.css';
import '@fontsource/sarabun/thai-500.css';
import '@fontsource/sarabun/latin-400.css';
import '@fontsource/sarabun/latin-500.css';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
