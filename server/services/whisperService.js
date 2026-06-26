const axios = require('axios');
const FormData = require('form-data');

// URL of the Python FastAPI Whisper service (deployed separately on Render).
// Strip trailing slashes so callers can safely template `${URL}/transcribe`.
const WHISPER_SERVICE_URL = (process.env.WHISPER_SERVICE_URL || 'http://localhost:8000')
  .replace(/\/+$/, '');

async function transcribeAudio(audioBuffer, filename) {
  const form = new FormData();
  form.append('file', audioBuffer, filename);

  const response = await axios.post(`${WHISPER_SERVICE_URL}/transcribe`, form, {
    headers: form.getHeaders(),
    // Whisper on free-tier CPU can take a while for longer clips; the request
    // is already chunked client-side, but give it generous headroom.
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return response.data; // { text, language }
}

module.exports = { transcribeAudio };
