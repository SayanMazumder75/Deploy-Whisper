import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

function SummaryView({ recordingId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/summaries/${recordingId}`);
      setSummary(res.data);
      clearInterval(pollRef.current);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    fetchSummary();
    pollRef.current = setInterval(fetchSummary, 8000);
    return () => clearInterval(pollRef.current);
  }, [fetchSummary]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/summaries/${recordingId}/generate`
      );
      setSummary(res.data);
      clearInterval(pollRef.current);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate summary. Is there a transcript yet?');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="summary-view"><p className="summary-loading">Loading summary…</p></div>;

  return (
    <div className="summary-view">
      <h3>Summary</h3>

      {error && <p className="summary-error">{error}</p>}

      {!summary ? (
        <div className="summary-empty-state">
          <p className="summary-empty">No summary available yet.</p>
          <button className="btn-generate" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : '✦ Generate Summary'}
          </button>
        </div>
      ) : (
        <>
          <p className="summary-text">{summary.summary}</p>

          {summary.keyPoints?.length > 0 && (
            <div className="summary-section">
              <h4>Key Points</h4>
              <ul>
                {summary.keyPoints.map((point, idx) => (
                  <li key={idx}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.actionItems?.length > 0 && (
            <div className="summary-section">
              <h4>Action Items</h4>
              <ul>
                {summary.actionItems.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn-generate" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Regenerating…' : '↺ Regenerate Summary'}
          </button>
        </>
      )}
    </div>
  );
}

export default SummaryView;
