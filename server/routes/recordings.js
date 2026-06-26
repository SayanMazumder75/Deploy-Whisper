const Summary = require('../models/Summary');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use the npm-installed static ffmpeg binary so this works on hosts without
// a system ffmpeg (e.g. Render's native Node runtime). If for any reason
// the package is missing, we fall back to a bare `ffmpeg` lookup on PATH.
let ffmpegPath = 'ffmpeg';
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path || 'ffmpeg';
} catch (_) {
  console.warn('[recordings] @ffmpeg-installer/ffmpeg not installed; falling back to system ffmpeg');
}

const Recording = require('../models/Recording');
const Transcript = require('../models/Transcript');
const { storeRecording } = require('../services/storageService');
const { transcribeAudio } = require('../services/whisperService');

const upload = multer({ storage: multer.memoryStorage() });

// GET all recordings
router.get('/', async (req, res) => {
  try {
    const recordings = await Recording.find().sort({ createdAt: -1 });
    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single recording
router.get('/:id', async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ error: 'Not found' });
    res.json(recording);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET stream video with range support (seeking)
router.get('/:id/stream', async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    console.log('Stream request for:', req.params.id, '| videoUrl:', recording?.videoUrl);

    if (!recording || !recording.videoUrl) {
      return res.status(404).json({ error: 'No recording file found' });
    }

    const { GridFSBucket } = require('mongodb');
    const mongoose = require('mongoose');
    const bucket = new GridFSBucket(mongoose.connection.db);
    const fileId = new mongoose.Types.ObjectId(recording.videoUrl);

    const files = await bucket.find({ _id: fileId }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found in storage' });
    }

    const file = files[0];
    const fileSize = file.length;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/webm',
      });

      const downloadStream = bucket.openDownloadStream(fileId, { start, end: end + 1 });
      downloadStream.on('error', (err) => { console.error('Range stream error:', err); });
      downloadStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/webm',
        'Accept-Ranges': 'bytes',
      });

      const downloadStream = bucket.openDownloadStream(fileId);
      downloadStream.on('error', (err) => { console.error('Full stream error:', err); });
      downloadStream.pipe(res);
    }
  } catch (err) {
    console.error('Stream route error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST create new recording
router.post('/', async (req, res) => {
  try {
    const { title, userId, source } = req.body;
    const recording = new Recording({
      title: title || 'Untitled Meeting',
      userId,
      source: source || 'meeting',
      status: 'recording'
    });
    await recording.save();
    const io = req.app.get('io');
    io.emit('recording-created', recording);
    res.status(201).json(recording);
  } catch (err) {
    console.error('Error creating recording:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST upload full recording — ffmpeg fixes duration metadata
router.post('/:id/upload', upload.single('recording'), async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ error: 'Not found' });

    const tmpDir = os.tmpdir();
    const inputPath  = path.join(tmpDir, `${req.params.id}_input.webm`);
    const outputPath = path.join(tmpDir, `${req.params.id}_fixed.webm`);

    fs.writeFileSync(inputPath, req.file.buffer);

    await new Promise((resolve) => {
      const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -c copy "${outputPath}"`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.warn('ffmpeg failed, using original:', stderr);
          fs.copyFileSync(inputPath, outputPath);
        }
        resolve();
      });
    });

    const fixedBuffer = fs.readFileSync(outputPath);
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}

    const fileId = await storeRecording(fixedBuffer, `${req.params.id}.webm`);
    recording.videoUrl = fileId.toString();
    recording.status = 'processing';
    await recording.save();

    res.json({ message: 'Recording uploaded', fileId });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST audio chunk for transcription
router.post('/:id/chunk', upload.single('chunk'), async (req, res) => {
  const recordingId = req.params.id;
  try {
    const io = req.app.get('io');

    if (!req.file) {
      console.error(`[chunk ${recordingId}] no file in request — multer did not receive 'chunk' field`);
      return res.status(400).json({ error: "missing 'chunk' field" });
    }

    const sizeMB = (req.file.buffer.length / 1024 / 1024).toFixed(2);
    console.log(
      `[chunk ${recordingId}] received file=${req.file.originalname} ` +
      `size=${sizeMB}MB mimetype=${req.file.mimetype}`
    );

    console.log(`[chunk ${recordingId}] calling transcribeAudio...`);
    const result = await transcribeAudio(req.file.buffer, `chunk_${Date.now()}.webm`);
    console.log(
      `[chunk ${recordingId}] whisper returned ` +
      `text.length=${(result?.text || '').length} language=${result?.language}`
    );

    if (result.text && result.text.trim()) {
      let transcript = await Transcript.findOne({ recordingId });
      if (!transcript) {
        console.log(`[chunk ${recordingId}] creating new Transcript document`);
        transcript = new Transcript({ recordingId, segments: [], fullText: '' });
      } else {
        console.log(`[chunk ${recordingId}] appending to existing Transcript`);
      }
      transcript.segments.push({ text: result.text, timestamp: Date.now() });
      transcript.fullText += ' ' + result.text;
      await transcript.save();
      console.log(
        `[chunk ${recordingId}] transcript saved — ` +
        `segments=${transcript.segments.length} fullText.length=${transcript.fullText.length}`
      );
      io.to(recordingId).emit('transcript-update', { text: result.text });
    } else {
      console.warn(
        `[chunk ${recordingId}] SKIPPING transcript save: whisper returned empty text. ` +
        `This is why GET /api/transcripts/${recordingId} will 404 and summary will say "Step 1 FAILED".`
      );
    }
    console.log('TRANSCRIPT:', result.text);
    res.json({ text: result.text });
  } catch (err) {
    console.error(`[chunk ${recordingId}] route error: ${err.message}`);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// PUT update recording status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const recording = await Recording.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    const io = req.app.get('io');
    io.emit('recording-updated', recording);
    res.json(recording);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE recording
router.delete('/:id', async (req, res) => {
  try {
    await Recording.findByIdAndDelete(req.params.id);
    await Transcript.deleteOne({ recordingId: req.params.id });
    await Summary.deleteOne({ recordingId: req.params.id });
    const io = req.app.get('io');
    io.emit('recording-deleted', req.params.id);
    res.json({ message: 'Recording deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;