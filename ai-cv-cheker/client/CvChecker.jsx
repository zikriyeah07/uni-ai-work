import { useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, FileText, RotateCcw, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import ToolHeader from '../../client/src/components/ToolHeader.jsx';

const MAX_FILE_BYTES = 2.8 * 1024 * 1024;

function fileType(file) {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'text/plain' || name.endsWith('.txt')) return 'text/plain';
  return null;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) reject(new Error('This file could not be read.'));
      else resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('This file could not be read.'));
    reader.readAsDataURL(file);
  });
}

async function parseApiError(response) {
  const body = await response.json().catch(() => ({}));
  return body?.error?.message || 'The CV could not be analyzed. Please try again.';
}

function AnalysisResult({ analysis, onReset }) {
  const score = Number(analysis.score);
  return (
    <div className="cv-results">
      <section className="cv-score-panel">
        <div className="cv-score-ring" style={{ '--score-degrees': `${score * 3.6}deg` }} aria-label={`AI assessment score ${score} out of 100`}>
          <div><b>{score}</b><span>out of 100</span></div>
        </div>
        <div className="cv-score-copy">
          <div className="tool-eyebrow">DOCUMENT ASSESSMENT</div>
          <h2>Your CV review</h2>
          <p>{analysis.summary}</p>
          <div className="cv-score-note"><Sparkles size={14} /> AI assessment based on the uploaded document</div>
        </div>
        <button className="button button-secondary button-small cv-reset" onClick={onReset}><RotateCcw size={14} /> Review another CV</button>
      </section>
      <div className="cv-result-grid">
        <section className="cv-result-card">
          <div className="cv-result-heading"><span className="cv-result-icon cv-good"><Check size={17} /></span><div><h3>What is working</h3><p>Strengths identified in this document</p></div></div>
          {analysis.strengths.length ? <ul className="cv-strength-list">{analysis.strengths.map((item, i) => <li key={`${i}-${item}`}><Check size={15} />{item}</li>)}</ul> : <p className="cv-no-data">No strengths were returned for this review.</p>}
        </section>
        <section className="cv-result-card cv-improvements-card">
          <div className="cv-result-heading"><span className="cv-result-icon cv-review"><FileText size={17} /></span><div><h3>Improvements to make</h3><p>Recommendations tied to the CV content</p></div></div>
          {analysis.improvements.length ? <div className="cv-improvements">{analysis.improvements.map((item, i) => <article className="cv-improvement" key={`${i}-${item.title}`}>
            <div className="cv-improvement-top"><h4>{item.title}</h4><span className={`cv-priority cv-priority-${item.priority.toLowerCase()}`}>{item.priority}</span></div>
            {item.evidence && <blockquote>“{item.evidence}”</blockquote>}
            <p className="cv-why"><b>Why it matters</b>{item.whyItMatters}</p>
            <p className="cv-fix"><b>Suggested edit</b>{item.suggestion}</p>
          </article>)}</div> : <p className="cv-no-data">No improvement items were returned for this review.</p>}
        </section>
      </div>
      {analysis.nextSteps.length > 0 && <section className="cv-result-card cv-next-steps">
        <div className="cv-result-heading"><span className="cv-result-icon cv-next"><ArrowRight size={17} /></span><div><h3>Next steps</h3><p>A short sequence for your next revision</p></div></div>
        <ol>{analysis.nextSteps.map((step, i) => <li key={`${i}-${step}`}><span>{String(i + 1).padStart(2, '0')}</span>{step}</li>)}</ol>
      </section>}
    </div>
  );
}

export default function CvChecker() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [targetRole, setTargetRole] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function selectFile(nextFile) {
    setError('');
    setAnalysis(null);
    if (!nextFile) return;
    if (!fileType(nextFile)) {
      setFile(null);
      setError('Choose a PDF or plain text (.txt) CV.');
      return;
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setFile(null);
      setError('The file is larger than 2.8 MB. Choose a smaller CV file.');
      return;
    }
    if (fileType(nextFile) === 'text/plain' && nextFile.size > 100 * 1024) {
      setFile(null);
      setError('Text CVs must be 100 KB or smaller. For longer CVs, upload a PDF.');
      return;
    }
    if (!nextFile.size) {
      setFile(null);
      setError('This file is empty. Choose a CV with content.');
      return;
    }
    setFile(nextFile);
  }

  async function analyze(event) {
    event.preventDefault();
    if (!file || busy) return;
    const mimeType = fileType(file);
    setBusy(true);
    setError('');
    try {
      const base64 = await toBase64(file);
      const response = await fetch('/api/cv/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, base64, targetRole: targetRole.trim() }),
        signal: AbortSignal.timeout(125000),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      const result = await response.json();
      if (!result.analysis || !Number.isFinite(result.analysis.score)) throw new Error('The AI response did not contain a valid CV assessment. Try again.');
      setAnalysis(result.analysis);
    } catch (requestError) {
      setError(requestError.name === 'TimeoutError' || requestError.name === 'AbortError'
        ? 'The analysis took too long. Try a smaller or text-based CV.'
        : requestError.message || 'The CV could not be analyzed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setAnalysis(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="tool-page cv-page">
      <ToolHeader active="/cv-checker" />
      <main className="tool-main">
        <section className="tool-page-heading">
          <div className="tool-eyebrow">CAREER TOOL · 01</div>
          <h1>AI CV Checker</h1>
          <p>Get a structured review of your CV, with an assessment score and concrete edits based on what is actually in the document.</p>
        </section>
        {analysis ? <AnalysisResult analysis={analysis} onReset={reset} /> : <div className="cv-workspace">
          <form className="cv-form-card" onSubmit={analyze}>
            <div className="cv-form-title"><span><FileText size={18} /></span><div><h2>Upload a CV</h2><p>Your file is analyzed for this request and is not saved to the database.</p></div></div>
            <label htmlFor="cv-target-role" className="tool-label">Target role <span>Optional</span></label>
            <input id="cv-target-role" className="tool-input" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} maxLength={120} placeholder="e.g. Front-end developer" disabled={busy} />
            <div
              className={`cv-dropzone ${file ? 'cv-dropzone-has-file' : ''} ${busy ? 'cv-dropzone-busy' : ''}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (!busy) selectFile(event.dataTransfer.files?.[0]); }}
            >
              <input ref={inputRef} id="cv-file-input" className="cv-file-input" type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event) => selectFile(event.target.files?.[0])} disabled={busy} />
              {file ? <>
                <label className="cv-dropzone-label" htmlFor="cv-file-input">
                  <span className="cv-upload-icon"><FileText size={22} /></span>
                  <span className="cv-file-detail"><b>{file.name}</b><span>{(file.size / 1024).toFixed(0)} KB · {fileType(file) === 'application/pdf' ? 'PDF document' : 'Text document'} · Click to replace</span></span>
                </label>
                {!busy && <button className="cv-remove-file" type="button" aria-label="Remove selected file" onClick={reset}><X size={17} /></button>}
              </> : <label className="cv-dropzone-label" htmlFor="cv-file-input">
                <span className="cv-upload-icon"><Upload size={21} /></span>
                <span><b>Drop your CV here or browse files</b><span>PDF up to 2.8 MB · TXT up to 100 KB</span></span>
              </label>}
            </div>
            {error && <div className="cv-error" role="alert"><CircleAlert size={16} />{error}</div>}
            <button className="button button-primary cv-submit" type="submit" disabled={!file || busy}>
              {busy ? <><span className="cv-spinner" /> Analyzing your CV…</> : <><Sparkles size={16} /> Analyze CV</>}
            </button>
            {busy && <p className="cv-progress-note" role="status">A free OpenRouter model is reviewing the document and preparing evidence-based suggestions.</p>}
            <div className="cv-privacy"><ShieldCheck size={15} /><span>Document content is sent to OpenRouter for review and is not saved by this app.</span></div>
          </form>
          <aside className="cv-side-panel">
            <div className="cv-side-mark">01</div>
            <h2>A useful review,<br />not a rewrite.</h2>
            <p>The report focuses on clarity, role relevance, impact, and structure. It points to evidence in your CV where possible and labels missing information clearly.</p>
            <div className="cv-review-criteria"><span><Check size={14} /> Role alignment</span><span><Check size={14} /> Specific achievements</span><span><Check size={14} /> Structure and readability</span><span><Check size={14} /> Practical next edits</span></div>
          </aside>
        </div>}
      </main>
    </div>
  );
}
