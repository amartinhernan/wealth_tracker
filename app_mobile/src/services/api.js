import { auth } from '../../firebaseConfig';

const BASE_URL = 'http://192.168.20.13:5000/api';

export const tokenFetch = async (endpoint, options = {}) => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No estás conectado');
  }
  
  const token = await user.getIdToken();
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  };

  if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  // Handle standard JSON or empty responses
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return await response.json();
  } else {
    return await response.text();
  }
};
