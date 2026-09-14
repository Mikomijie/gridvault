import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// App-shell offline support (AT-623). Registered after first paint so it
// never delays the initial render; a failed registration (unsupported
// browser, insecure context) is silently a no-op — the app still works
// online, it just cannot cold-boot offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
