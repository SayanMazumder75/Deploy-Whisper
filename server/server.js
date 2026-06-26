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
// CLIENT_URL can be a single origin or comma-separated list of allowed
// origins (e.g. "https://meetmind.vercel.app,https://staging.vercel.app").
// In development we default to the CRA dev server origin.
const clientOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin / curl / health checks with no Origin header.
    if (!origin) return callback(null, true);
    if (clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

const io = new Server(server, {
  cors: { origin: clientOrigins, methods: ['GET', 'POST'], credentials: true },
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
  console.log(`Allowed client origins: ${clientOrigins.join(', ')}`);
});
