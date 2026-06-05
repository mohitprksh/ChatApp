import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// BUG FIX #2: Removed React.StrictMode.
// StrictMode intentionally double-invokes effects in development to help
// detect side-effects. This causes the socket to connect, get torn down by
// StrictMode's cleanup, then immediately reconnect — producing the
// connect/disconnect loop visible in server logs.
// If you want StrictMode back, add the guard in SocketContext.jsx:
//   if (socketRef.current?.connected) return;
// That guard is already present in the fixed SocketContext, so you CAN
// re-enable StrictMode if preferred — both approaches are safe together.
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
