const axios = require('axios');
const FormData = require('form-data');

// URL of the Python FastAPI Whisper service (deployed separately on Render).
// Strip trailing slashes so callers can safely template `${URL}/transcribe`.
const WHISPER_SERVICE_URL = (process.env.WHISPER_SERVICE_URL || 'http://localhost:8000')
  .replace(/\/+$/, '');

// One-time startup log so it's obvious in Render logs whether the env var
// is set correctly. If you see `http://localhost:8000` in production, you
// forgot to set WHISPER_SERVICE_URL on the Node service.
console.log(`[whisperService] WHISPER_SERVICE_URL = ${WHISPER_SERVICE_URL}`);

async function transcribeAudio(audioBuffer, filename) {
  const form = new FormData();
  form.append('file', audioBuffer, filename);

  const url = `${WHISPER_SERVICE_URL}/transcribe`;
  const sizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
  const startedAt = Date.now();

  console.log(`[whisperService] POST ${url} (file=${filename}, size=${sizeMB}MB)`);

  try {
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      // Whisper on free-tier CPU can take a while. Bumped from 120s -> 300s
      // because transcribing a multi-minute recording on a 512MB CPU
      // instance can easily exceed 2 minutes.
      timeout: 300000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const ms = Date.now() - startedAt;
    const text = response?.data?.text ?? '';
    console.log(
      `[whisperService] response ${response.status} in ${ms}ms — ` +
      `text.length=${text.length}, language=${response?.data?.language}`
    );

    return response.data; // { text, language }
  } catch (err) {
    const ms = Date.now() - startedAt;
    // axios errors can come in three shapes: response received with non-2xx,
    // request sent but no response (timeout/socket), or setup error.
    if (err.response) {
      console.error(
        `[whisperService] HTTP ${err.response.status} from Whisper after ${ms}ms — ` +
        `body=${JSON.stringify(err.response.data).slice(0, 500)}`
      );
    } else if (err.request) {
      console.error(
        `[whisperService] no response after ${ms}ms — code=${err.code} message=${err.message}`
      );
    } else {
      console.error(`[whisperService] request setup error: ${err.message}`);
    }
    throw err;
  }
}

module.exports = { transcribeAudio };
