import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import '../styles/recording-controls.css';

const SERVER_URL = API_URL;

const SOURCE_OPTIONS = [
  { value: 'meeting', emoji: '🎯', label: 'Meeting' },
  { value: 'youtube', emoji: '▶️', label: 'YouTube' },
  { value: 'voice',   emoji: '🎙️', label: 'Voice Note' },
];

// Opens stopper.html as a real popup window that stays on top
function openFloatingStopWindow() {
  const w = 280, h = 160;
  const left = window.screen.width - w - 20;
  const top  = 20;

  const popup = window.open(
    '/stopper.html',
    'StopRecording',
    `width=${w},height=${h},left=${left},top=${top},resizable=no,toolbar=no,menubar=no,scrollbars=no,status=no,location=no`
  );

  if (!popup) {
    alert(`Please allow popups for ${window.location.origin} — click the popup blocked icon in your address bar!`);
    return null;
  }

  return popup;
}

function RecordingControls({ onRecordingChange }) {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [duration, setDuration] = useState(0);
  const [source, setSource] = useState('meeting');

  const mediaRecorderRef = useRef(null);
  const recordingIdRef   = useRef(null);
  const timerRef         = useRef(null);
  const streamRef        = useRef(null);
  const chunkBufferRef   = useRef([]);
  const mimeTypeRef      = useRef('video/webm');
  const popupRef         = useRef(null);

  // Listen for stop message from popup
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'STOP_RECORDING_FROM_POPUP') {
        stopRecording();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isRecording) {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setDuration(0);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = async () => {
    setErrorMsg('');
    setStatus('requesting');
    try {
      let micStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        throw new Error('Microphone access denied.');
      }

      let displayStream = null;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: { echoCancellation: false, noiseSuppression: false }
        });
      } catch {
        console.log('No screen capture — mic only.');
      }

      const audioCtx = new AudioContext();
      const audioDestination = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(micStream).connect(audioDestination);
      if (displayStream?.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(displayStream).connect(audioDestination);
      }

      const videoTracks = displayStream?.getVideoTracks() || [];
      const combinedStream = new MediaStream([
        ...videoTracks,
        ...audioDestination.stream.getAudioTracks()
      ]);

      streamRef.current = { micStream, displayStream, audioCtx };

      const res = await axios.post(`${SERVER_URL}/api/recordings`, {
        title: `Meeting – ${new Date().toLocaleString()}`,
        userId: '123',
        source
      });
      recordingIdRef.current = res.data._id;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(
        videoTracks.length > 0 ? combinedStream : audioDestination.stream,
        { mimeType: videoTracks.length > 0 ? mimeType : 'audio/webm' }
      );
      mediaRecorderRef.current = mediaRecorder;
      chunkBufferRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunkBufferRef.current.push(e.data);
      };

      if (displayStream) {
        displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (mediaRecorderRef.current?.state !== 'inactive') stopRecording();
        });
      }

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('recording');
      if (onRecordingChange) onRecordingChange(true, recordingIdRef.current);

      // Open floating stop popup
      popupRef.current = openFloatingStopWindow();

    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to start recording.');
      stopAllTracks();
    }
  };

  const stopAllTracks = () => {
    if (streamRef.current) {
      streamRef.current.micStream?.getTracks().forEach(t => t.stop());
      streamRef.current.displayStream?.getTracks().forEach(t => t.stop());
      streamRef.current.audioCtx?.close().catch(() => {});
      streamRef.current = null;
    }
  };

  const stopRecording = async () => {
    if (status === 'stopping' || !mediaRecorderRef.current) return;
    setStatus('stopping');

    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
      popupRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    const id = recordingIdRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.requestData();
      await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    }

    stopAllTracks();

    if (chunkBufferRef.current.length > 0 && id) {
      const fullBlob = new Blob(chunkBufferRef.current, { type: mimeTypeRef.current });
      console.log(`Uploading: ${(fullBlob.size / 1024 / 1024).toFixed(2)} MB`);

      const formData = new FormData();
      formData.append('recording', fullBlob, `${id}.webm`);
      try {
        await axios.post(`${SERVER_URL}/api/recordings/${id}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } catch (err) { console.warn('Upload failed:', err.message); }

      const audioFormData = new FormData();
      audioFormData.append('chunk', fullBlob, `chunk_${Date.now()}.webm`);
      try {
        await axios.post(`${SERVER_URL}/api/recordings/${id}/chunk`, audioFormData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } catch (err) { console.warn('Transcription failed:', err.message); }
    }

    if (id) {
      try {
        await axios.put(`${SERVER_URL}/api/recordings/${id}/status`, { status: 'completed' });
        await axios.post(`${SERVER_URL}/api/summaries/${id}/generate`);
      } catch (err) { console.warn('Finalize failed:', err.message); }
    }

    mediaRecorderRef.current = null;
    recordingIdRef.current = null;
    chunkBufferRef.current = [];
    setIsRecording(false);
    setStatus('idle');
    if (onRecordingChange) onRecordingChange(false, null);
  };

  return (
    <div className="recording-controls">
      {status === 'error' && <p className="recording-error">{errorMsg}</p>}

      {!isRecording && (
        <div className="source-selector">
          <p className="source-label-text">What are you recording?</p>
          <div className="source-options">
            {SOURCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`source-option ${source === opt.value ? 'active' : ''}`}
                onClick={() => setSource(opt.value)}
                disabled={status === 'stopping'}
              >
                <span className="source-opt-emoji">{opt.emoji}</span>
                <span className="source-opt-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isRecording && (
        <div className="recording-status-bar">
          <span className="rec-dot" />
          <span className="rec-label">Recording</span>
          <span className="rec-source-tag">
            {SOURCE_OPTIONS.find(o => o.value === source)?.emoji}{' '}
            {SOURCE_OPTIONS.find(o => o.value === source)?.label}
          </span>
          <span className="rec-timer">{formatDuration(duration)}</span>
        </div>
      )}

      <div className="recording-buttons">
        <button
          className="btn-start"
          onClick={startRecording}
          disabled={isRecording || status === 'requesting' || status === 'stopping'}
        >
          {status === 'requesting' ? 'Starting…' : '● Start Recording'}
        </button>
        <button
          className="btn-stop"
          onClick={stopRecording}
          disabled={!isRecording || status === 'stopping'}
        >
          {status === 'stopping' ? 'Uploading…' : '■ Stop Recording'}
        </button>
      </div>

      {status === 'requesting' && (
        <p className="recording-hint">Allow mic access, then select the tab to record.</p>
      )}
      {isRecording && (
        <p className="recording-hint">
          🪟 Use the floating <strong>Stop</strong> window to stop from any tab!
        </p>
      )}
      {!isRecording && status === 'idle' && (
        <p className="recording-hint">
          Click <strong>Start Recording</strong> — a floating stop button will appear so you can stop from any tab.
        </p>
      )}
      {status === 'stopping' && (
        <p className="recording-hint">Uploading your recording, please wait…</p>
      )}
    </div>
  );
}

export default RecordingControls;
