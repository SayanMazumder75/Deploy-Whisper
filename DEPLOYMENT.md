# Deployment Guide — Vercel + Render

This guide walks through deploying Deploy-Whisper to production:

- **Vercel** hosts the React client (`/client`).
- **Render** hosts two services:
  - The Node/Express + Socket.io API (`/server`).
  - The Python FastAPI Whisper transcription service (`/whisper_service`).
- **MongoDB Atlas** provides the database (used for both regular collections
  and GridFS to store recording files).
- **Groq** provides the LLM used to generate meeting summaries.

```
   Browser ──HTTPS / WSS──► Vercel (React)
                              │
                              │ REST + Socket.io
                              ▼
                       Render: Node API ──HTTPS──► Render: Whisper (FastAPI)
                              │
                              ▼
                       MongoDB Atlas (data + GridFS)
                              │
                              ▼
                          Groq API (LLM)
```

---

## 0. Prerequisites

You will need free or paid accounts for:

| Service        | What for                                         |
| -------------- | ------------------------------------------------ |
| GitHub         | Source for Render & Vercel auto-deploys          |
| MongoDB Atlas  | Database (free M0 tier is enough to start)       |
| Groq           | LLM API key for summaries                        |
| Render         | Hosts the two backend services                   |
| Vercel         | Hosts the static React build                     |

---

## 1. Set up MongoDB Atlas

1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Under **Database Access**, create a user with a strong password.
3. Under **Network Access**, allow `0.0.0.0/0` (or restrict to Render's
   egress IPs if your plan supports it).
4. Copy the connection string. It looks like:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/meeting-recorder?retryWrites=true&w=majority
   ```
   You'll paste this as `MONGO_URI` later.

## 2. Get a Groq API key

1. Sign up at [console.groq.com](https://console.groq.com).
2. Create an API key. You'll paste this as `GROQ_API_KEY`.

---

## 3. Deploy the backends to Render

The repo includes a `render.yaml` Blueprint at the root, which deploys
both backend services together.

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. In the Render dashboard, click **New +** → **Blueprint**.
3. Connect your GitHub account and select the `Deploy-Whisper` repo.
4. Render reads `render.yaml` and proposes two services:
   - `deploy-whisper-asr` (Python, runs from `/whisper_service`)
   - `deploy-whisper-api` (Node, runs from `/server`)
5. Click **Apply**. Render will start building both services in parallel.
6. While they build, click into `deploy-whisper-api` → **Environment**
   and fill in the four env vars marked as required:

   | Key                   | Example                                                              |
   | --------------------- | -------------------------------------------------------------------- |
   | `MONGO_URI`           | `mongodb+srv://USER:PASS@cluster.mongodb.net/meeting-recorder`        |
   | `GROQ_API_KEY`        | `gsk_...`                                                             |
   | `CLIENT_URL`          | leave blank for now — fill after the Vercel deploy is live            |
   | `WHISPER_SERVICE_URL` | the public URL of `deploy-whisper-asr` (e.g. `https://deploy-whisper-asr.onrender.com`) — visible on its service page once it finishes deploying |

7. After saving, **Manual Deploy** the API service so it picks up the new
   env vars.

### Option B — Manual (if you prefer not to use Blueprints)

Create two **Web Services** in Render, each pointing at this repo, with
the settings below.

**Whisper service** (`deploy-whisper-asr`):

| Field             | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Runtime           | Python 3                                             |
| Root directory    | `whisper_service`                                    |
| Build command     | `pip install -r requirements.txt`                    |
| Start command     | `uvicorn main:app --host 0.0.0.0 --port $PORT`       |
| Health check path | `/healthz`                                           |

Environment variables:

| Key               | Default value                                       |
| ----------------- | --------------------------------------------------- |
| `WHISPER_MODEL`   | `base` (use `small` for better accuracy + more RAM) |
| `WHISPER_DEVICE`  | `cpu`                                               |
| `WHISPER_COMPUTE` | `int8`                                              |
| `CORS_ORIGINS`    | `*`                                                 |
| `PYTHON_VERSION`  | `3.11.9`                                            |

**Node API service** (`deploy-whisper-api`):

| Field             | Value                |
| ----------------- | -------------------- |
| Runtime           | Node                 |
| Root directory    | `server`             |
| Build command     | `npm install`        |
| Start command     | `node server.js`     |
| Health check path | `/healthz`           |

Environment variables: same list as Option A step 6, plus
`NODE_VERSION=20.11.1`.

---

## 4. Deploy the client to Vercel

1. In the Vercel dashboard, click **Add New** → **Project** and import the
   GitHub repo.
2. **Root Directory:** set this to `client`. Vercel will detect Create
   React App automatically (the included `client/vercel.json` makes this
   explicit and also sets up SPA fallback routing).
3. **Environment Variables:** add a single var:

   | Key                  | Value                                              |
   | -------------------- | -------------------------------------------------- |
   | `REACT_APP_API_URL`  | full https URL of your Render API service, e.g. `https://deploy-whisper-api.onrender.com` |

   Apply it to **Production**, **Preview**, and **Development** scopes.
4. Click **Deploy**. Once the first deploy finishes, copy the resulting
   Vercel URL (e.g. `https://your-app.vercel.app`).

---

## 5. Wire the Vercel origin back into the Render API

The Node API rejects WebSocket and CORS requests from origins that aren't
in `CLIENT_URL`, so finalize it now:

1. In Render, open `deploy-whisper-api` → **Environment**.
2. Set `CLIENT_URL` to your Vercel URL. To allow Vercel preview deploys
   as well, use a comma-separated list:
   ```
   https://your-app.vercel.app,https://your-app-git-main-<team>.vercel.app
   ```
3. Save → the service automatically redeploys.

---

## 6. Smoke test

Open your Vercel URL in Chrome (the recorder uses `MediaRecorder` +
`getDisplayMedia`, which require a Chromium-based browser).

| Check                            | Expected                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| Dashboard loads                  | Stats panel renders, recordings list is empty or populated    |
| `GET /healthz` on API            | `{ "status": "ok", "mongo": "connected", ... }`               |
| `GET /healthz` on whisper        | `{ "status": "ok", "model": "base" }`                         |
| Start Recording                  | Mic permission prompt, then floating stop window appears      |
| Stop Recording                   | Upload progress, then a new entry appears in the meetings list |
| Open the meeting                 | Live transcript text appears in the Live Transcript tab       |
| Click Generate Summary           | Groq returns summary, key points, action items                |

---

## 7. Operational notes & gotchas

**Render free / starter web services sleep after ~15 min of inactivity.**
The first request after a sleep takes 30–60 seconds (and for the whisper
service, longer because it re-downloads the model into ephemeral disk).
For demo use this is fine; for anything serious upgrade to Standard.

**Whisper RAM usage at runtime:**

| Model     | Approx peak RAM | Recommended Render plan                  |
| --------- | --------------- | ---------------------------------------- |
| `tiny`    | ~250 MB         | Starter (512 MB) — comfortable           |
| `base`    | ~500 MB         | Starter (512 MB) — borderline; default   |
| `small`   | ~800 MB         | Standard (2 GB)                          |
| `medium`  | ~2.5 GB         | Pro (4 GB) or larger                     |

The blueprint defaults to `base`. Bump `WHISPER_MODEL` in env vars to
trade accuracy for memory.

**Models are downloaded on first request** from HuggingFace, then cached
under `~/.cache/huggingface`. Render's free/starter web services do not
have persistent disks, so the model is re-downloaded on every cold
start. To make this persistent, attach a Render Disk and point
`HF_HOME` (and/or `XDG_CACHE_HOME`) at it.

**Socket.io transport:** Render terminates TLS and forwards WebSockets,
so `socket.io-client` works out of the box once `CLIENT_URL` is set
correctly on the API.

**File uploads:** the whole recording is uploaded in one POST after stop.
For long meetings (e.g. >100 MB) you'll want to either bump Render's
plan or stream the upload to S3/R2 instead of GridFS — out of scope here.

**Chrome extension:** the `extension/` directory still hardcodes
`http://localhost:5000`. If you want to use the extension against the
production API, edit `extension/background.js`, `extension/offscreen.js`,
and `extension/manifest.json` to point at your Render URL — the web app
itself (Vercel) does not need the extension.

---

## 8. Local development reminders

After pulling these changes, set up local `.env` files:

```bash
# server/.env
cp server/.env.example server/.env
# then fill MONGO_URI, GROQ_API_KEY, leave the rest as defaults

# whisper_service/.env (optional — defaults are fine)
cp whisper_service/.env.example whisper_service/.env

# client/.env.development.local (optional — default already works)
cp client/.env.example client/.env.development.local
```

Run the three services in three terminals:

```bash
# 1. Whisper
cd whisper_service && pip install -r requirements.txt && uvicorn main:app --port 8000 --reload

# 2. API
cd server && npm install && npm run dev

# 3. Client
cd client && npm install && npm start
```
