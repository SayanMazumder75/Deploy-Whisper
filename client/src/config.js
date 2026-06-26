// Centralized runtime configuration for the React client.
//
// In CRA, environment variables must be prefixed with REACT_APP_ and are
// inlined at build time. Define REACT_APP_API_URL in Vercel's project
// settings (e.g. https://meetmind-api.onrender.com).
//
// Trailing slashes are stripped so callers can safely template
// `${API_URL}/api/...`.
const RAW_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
export const API_URL = RAW_API_URL.replace(/\/+$/, '');

// Socket.io connects to the same origin as the REST API.
export const SOCKET_URL = API_URL;
