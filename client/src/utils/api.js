import axios from 'axios';

const api = axios.create({
  // Same-origin by default (dev proxy / production). Override only for a separate API domain.
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 45000, // a manual check can take ~3 attempts × timeout
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const data = error.response?.data?.error;
    let message = data?.message || error.message || 'An error occurred';
    // Surface the first field-level validation message when there is one.
    if (data?.details && typeof data.details === 'object') {
      const first = Object.entries(data.details).find(([k, v]) => k !== '_errors' && v?._errors?.length);
      if (first) message = `${first[0]}: ${first[1]._errors[0]}`;
    }
    // No response, or the dev proxy answering for an API that isn't running.
    if (!error.response || (!data && [502, 503, 504].includes(error.response.status))) {
      message = 'Cannot reach the PulseWatch server. Check that the API is running (npm run dev in server/).';
    }
    const err = new Error(message);
    err.status = error.response?.status;
    err.code = data?.details?.code;
    return Promise.reject(err);
  }
);

export const isAbort = (err) => axios.isCancel(err) || err?.name === 'CanceledError' || err?.name === 'AbortError';

export default api;
