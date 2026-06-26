import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';
import { API_URL, SOCKET_URL } from '../config';

// Source icons & labels
const SOURCE_CONFIG = {
  meeting: { emoji: '🎯', label: 'Meeting' },
  youtube: { emoji: '▶️', label: 'YouTube' },
  voice:   { emoji: '🎙️', label: 'Voice Note' },
};

function RecordingsList() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchRecordings = () => {
    axios.get(`${API_URL}/api/recordings`)
      .then((res) => setRecordings(res.data))
      .catch((err) => console.error('Failed to fetch recordings:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecordings();
    const socket = io(SOCKET_URL);
    socket.on('recording-created', (newRecording) => setRecordings((prev) => [newRecording, ...prev]));
    socket.on('recording-updated', (updated) => setRecordings((prev) => prev.map((rec) => rec._id === updated._id ? updated : rec)));
    socket.on('recording-deleted', (deletedId) => setRecordings((prev) => prev.filter((rec) => rec._id !== deletedId)));
    return () => socket.disconnect();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API_URL}/api/recordings/${deleteTarget}`);
      setRecordings((prev) => prev.filter((rec) => rec._id !== deleteTarget));
    } catch (err) {
      console.error('Failed to delete recording:', err);
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) return <p>Loading recordings...</p>;

  return (
    <div className="recordings-list">
      {recordings.length === 0 && <p>No recordings yet.</p>}
      <ul>
        {recordings.map((rec) => {
          const src = SOURCE_CONFIG[rec.source] || SOURCE_CONFIG.meeting;
          return (
            <li key={rec._id} className="recording-item">
              <Link to={`/meeting/${rec._id}`}>
                {/* Source badge */}
                <span className={`source-badge source-${rec.source || 'meeting'}`}>
                  <span className="source-emoji">{src.emoji}</span>
                  <span className="source-label">{src.label}</span>
                </span>

                <span className="rec-title">{rec.title || 'Untitled Meeting'}</span>
                <span className="rec-date">{new Date(rec.createdAt).toLocaleString()}</span>
                <span className={`rec-status status-${rec.status}`}>{rec.status}</span>
                <button
                  className="btn-delete"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(rec._id); }}
                  aria-label="Delete recording"
                >
                  Delete
                </button>
              </Link>
            </li>
          );
        })}
      </ul>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete meeting?</h3>
            <p>This will permanently remove the recording, transcript, and summary.</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn-confirm-delete" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecordingsList;
