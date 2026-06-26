require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const recordingsRouter = require('./routes/recordings');
const transcriptsRouter = require('./routes/transcripts');
const summariesRouter = require('./routes/summaries');

const app = express();
const server = http.createServer(app);

// ── CORS ────────────────────────────────────────────────────────────────
// In production, set CLIENT_URL to a single origin or comma-separated list
// (e.g. "https://meetmind.vercel.app,https://staging.vercel.app") and the
// API will reject any other origin.
//
// In development, leave CLIENT_URL unset. The API will then accept any
// origin (matching the pre-deploy `cors()` behavior so the Chrome extension,
// curl, etc. continue to work locally).
const clientOriginsRaw = process.env.CLIENT_URL;
const clientOrigins = clientOriginsRaw
  ? clientOriginsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const allowAnyOrigin = clientOrigins.length === 0;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin / curl / health checks with no Origin header.
    if (!origin) return callback(null, true);
    if (allowAnyOrigin) return callback(null, true);
    if (clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: allowAnyOrigin ? true : clientOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io accessible in routes via req.app.get('io')
app.set('io', io);

app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint for Render
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  });
});

// Routes
app.use('/api/recordings', recordingsRouter);
app.use('/api/transcripts', transcriptsRouter);
app.use('/api/summaries', summariesRouter);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-recording', (recordingId) => {
    socket.join(recordingId);
    console.log(`Socket ${socket.id} joined room ${recordingId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/meeting-recorder';
mongoose
  .connect(mongoUri)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    `Allowed client origins: ${
      allowAnyOrigin ? '(any — CLIENT_URL not set)' : clientOrigins.join(', ')
    }`
  );
});
