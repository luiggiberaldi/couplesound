import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Sin StrictMode a propósito: en desarrollo duplica los efectos y con ellos la
// suscripción al canal y el track() de presencia, que Supabase limita a 5
// llamadas por cliente cada 30 s.
createRoot(document.getElementById('root')).render(<App />);
