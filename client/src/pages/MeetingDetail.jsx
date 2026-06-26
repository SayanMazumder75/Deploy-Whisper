import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { API_URL, SOCKET_URL } from '../config';

const SERVER_URL = API_URL;

function MeetingDetail() {
  const { id } = useParams();
  const [recording, setRecording] = useState(null);
  const [activeTab, setActiveTab] = useState('transcript');
  const [segments, setSegments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [language, setLanguage] = useState('english'); // NEW

  // Fetch recording info
  useEffect(() => {
    axios.get(`${SERVER_URL}/api/recordings/${id}`).then(r => setRecording(r.data)).catch(() => {});
  }, [id]);

  // Fetch transcript + live updates
  useEffect(() => {
    axios.get(`${SERVER_URL}/api/transcripts/${id}`)
      .then(r => { if (r.data.segments) setSegments(r.data.segments); })
      .catch(() => {});

    const socket = io(SOCKET_URL);
    socket.emit('join-recording', id);
    socket.on('transcript-update', (data) => setSegments(prev => [...prev, data]));
    return () => socket.disconnect();
  }, [id]);

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    try {
      const res = await axios.get(`${SERVER_URL}/api/summaries/${id}`);
      setSummary(res.data);
    } catch { setSummary(null); }
    finally { setSummaryLoading(false); }
  }, [id]);

  useEffect(() => {
    fetchSummary();
    const poll = setInterval(fetchSummary, 8000);
    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // language -> data, with fallback to legacy top-level fields (old docs, english only)
  const getLangData = (lang) => {
    if (summary?.summaries?.[lang]) return summary.summaries[lang];
    if (lang === 'english' && summary?.summary) {
      return { summary: summary.summary, keyPoints: summary.keyPoints, actionItems: summary.actionItems };
    }
    return null;
  };

  const currentData = getLangData(language);

  const handleGenerate = async (lang) => {
    setGenerating(true);
    setSummaryError('');
    try {
      const res = await axios.post(`${SERVER_URL}/api/summaries/${id}/generate`, { language: lang });
      setSummary(res.data);
      setLanguage(lang);
    } catch (err) {
      setSummaryError(err.response?.data?.error || 'Failed to generate summary.');
    } finally { setGenerating(false); }
  };

  const tabs = [
    { key: 'transcript', label: 'Live Transcript', emoji: '📝' },
    { key: 'summary',    label: 'Summary',         emoji: '🧠' },
    { key: 'keypoints',  label: 'Key Points',      emoji: '🎯' },
    { key: 'actions',    label: 'Action Items',    emoji: '✅' },
  ];

  const LANGS = [
    { key: 'english', label: 'English' },
    { key: 'hindi', label: 'Hindi' },
    { key: 'bengali', label: 'Bengali' },
  ];

  const hasVideo = recording?.videoUrl;

  return (
    <div className="md-page">

      {/* ── TOP: Video Player ─────────────────────────────────────── */}
      {hasVideo && (
        <div className="md-video-wrap">
          <video
            controls
            className="md-video"
            src={`${SERVER_URL}/api/recordings/${id}/stream`}
            preload="metadata"
          />
        </div>
      )}

      {/* ── BOTTOM: Sidebar + Content ─────────────────────────────── */}
      <div className="md-body">

        {/* Sidebar */}
        <aside className="md-sidebar">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`md-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="md-tab-emoji">{tab.emoji}</span>
              <span className="md-tab-label">{tab.label}</span>
            </button>
          ))}
        </aside>

        {/* Content panel */}
        <div className="md-content">

          {activeTab === 'transcript' && (
            <div className="md-panel">
              <h2 className="md-panel-title">Live Transcript</h2>
              <div className="md-transcript-box">
                {segments.length === 0
                  ? <p className="md-placeholder">Waiting for speech…</p>
                  : segments.map((seg, i) => (
                      <p key={i} className="md-transcript-line">{seg.text}</p>
                    ))
                }
              </div>
            </div>
          )}

          {activeTab === 'summary' && (
            <div className="md-panel">
              <h2 className="md-panel-title">Summary</h2>

              {/* NEW: language switcher tabs */}
              <div className="md-lang-switch" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {LANGS.map(l => (
                  <button
                    key={l.key}
                    onClick={() => setLanguage(l.key)}
                    className={`md-lang-btn ${language === l.key ? 'active' : ''}`}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: language === l.key ? '1px solid #d946ef' : '1px solid #333',
                      background: language === l.key ? 'rgba(217,70,239,0.15)' : 'transparent',
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    {l.label}{getLangData(l.key) ? ' ✓' : ''}
                  </button>
                ))}
              </div>

              {summaryLoading
                ? <p className="md-placeholder">Loading…</p>
                : summaryError
                  ? <p className="md-error">{summaryError}</p>
                  : !currentData
                    ? <div>
                        <p className="md-placeholder">No {LANGS.find(l=>l.key===language)?.label} summary yet.</p>
                        <button
                          className="md-btn-generate"
                          onClick={() => handleGenerate(language)}
                          disabled={generating}
                        >
                          {generating ? 'Generating…' : `✦ Generate ${LANGS.find(l=>l.key===language)?.label} Summary`}
                        </button>
                      </div>
                    : <div>
                        <p className="md-summary-text">{currentData.summary}</p>
                        <button
                          className="md-btn-generate"
                          onClick={() => handleGenerate(language)}
                          disabled={generating}
                          style={{marginTop:16}}
                        >
                          {generating ? 'Regenerating…' : `↺ Regenerate ${LANGS.find(l=>l.key===language)?.label}`}
                        </button>
                      </div>
              }

              {/* generate-all-three row */}
              {!summaryLoading && !summaryError && (
                <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {LANGS.map(l => (
                    <button
                      key={l.key}
                      className="md-btn-generate"
                      onClick={() => handleGenerate(l.key)}
                      disabled={generating}
                      style={{ opacity: language === l.key ? 1 : 0.7 }}
                    >
                      {generating && language === l.key ? '...' : `Generate ${l.label} Summary`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'keypoints' && (
            <div className="md-panel">
              <h2 className="md-panel-title">Key Points</h2>
              {!currentData
                ? <p className="md-placeholder">Generate a {LANGS.find(l=>l.key===language)?.label} summary first to see key points.</p>
                : currentData.keyPoints?.length > 0
                  ? <ul className="md-list">
                      {currentData.keyPoints.map((pt, i) => <li key={i}>{pt}</li>)}
                    </ul>
                  : <p className="md-placeholder">No key points available.</p>
              }
            </div>
          )}

          {activeTab === 'actions' && (
            <div className="md-panel">
              <h2 className="md-panel-title">Action Items</h2>
              {!currentData
                ? <p className="md-placeholder">Generate a {LANGS.find(l=>l.key===language)?.label} summary first to see action items.</p>
                : currentData.actionItems?.length > 0
                  ? <ul className="md-list md-list--actions">
                      {currentData.actionItems.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  : <p className="md-placeholder">No action items found.</p>
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default MeetingDetail;
