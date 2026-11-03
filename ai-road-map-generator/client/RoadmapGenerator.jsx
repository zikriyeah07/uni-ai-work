import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CircleAlert, Clipboard, Clock3, Flag, RefreshCw, Route, Sparkles } from 'lucide-react';
import ToolHeader from '../../client/src/components/ToolHeader.jsx';

async function errorMessage(response) {
  const body = await response.json().catch(() => ({}));
  return body?.error?.message || 'The roadmap could not be generated. Please try again.';
}

function roadmapMarkdown(roadmap) {
  return [
    `# ${roadmap.title}`,
    '',
    roadmap.overview,
    '',
    ...roadmap.milestones.flatMap((item) => [
      `## Month ${item.month} · ${item.phase}`,
      '',
      `**Focus:** ${item.focus}`,
      '',
      item.outcome,
      '',
      ...item.tasks.map((task) => `- [ ] ${task}`),
      '',
      `**Deliverable:** ${item.deliverable}`,
      '',
    ]),
    '## Weekly rhythm',
    ...roadmap.weeklyRhythm.map((item) => `- ${item}`),
    '',
    '## Success checks',
    ...roadmap.successChecks.map((item) => `- ${item}`),
  ].join('\n');
}

function RoadmapResult({ roadmap, duration, onReset, onNotice }) {
  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(roadmapMarkdown(roadmap));
      onNotice('Roadmap copied to clipboard.');
    } catch {
      onNotice('Clipboard access is unavailable in this browser. Use Download plan instead.', true);
    }
  }

  function downloadPlan() {
    const blob = new Blob([roadmapMarkdown(roadmap)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${roadmap.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'roadmap'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotice('Markdown plan downloaded.');
  }

  return (
    <div className="roadmap-results">
      <section className="roadmap-result-intro">
        <div className="roadmap-result-mark"><Route size={22} /></div>
        <div className="roadmap-result-copy">
          <div className="tool-eyebrow">YOUR {duration}-MONTH PLAN</div>
          <h2>{roadmap.title}</h2>
          <p>{roadmap.overview}</p>
        </div>
        <div className="roadmap-result-actions">
          <button className="button button-secondary button-small" type="button" onClick={copyPlan}><Clipboard size={14} /> Copy</button>
          <button className="button button-secondary button-small" type="button" onClick={downloadPlan}><ArrowDownToLine size={14} /> Download</button>
          <button className="button button-primary button-small" type="button" onClick={onReset}><RefreshCw size={14} /> New plan</button>
        </div>
      </section>
      <section className="roadmap-timeline-section">
        <div className="roadmap-section-heading"><div><div className="tool-eyebrow">MILESTONES</div><h3>From goal to deliverables</h3></div><span>{roadmap.milestones.length} phases</span></div>
        <div className="roadmap-timeline">
          {roadmap.milestones.map((milestone, index) => <article className="roadmap-milestone" key={`${milestone.month}-${milestone.phase}`}>
            <div className="roadmap-timeline-rail"><span>{String(index + 1).padStart(2, '0')}</span></div>
            <div className="roadmap-milestone-card">
              <div className="roadmap-milestone-top"><div><span className="roadmap-month">MONTH {milestone.month}</span><h4>{milestone.phase}</h4></div><span className="roadmap-focus"><Flag size={13} />{milestone.focus}</span></div>
              <p className="roadmap-outcome">{milestone.outcome}</p>
              <div className="roadmap-task-grid"><div><b>Work to do</b><ul>{milestone.tasks.map((task, taskIndex) => <li key={`${taskIndex}-${task}`}><span><Check size={12} /></span>{task}</li>)}</ul></div><div className="roadmap-deliverable"><span>DELIVERABLE</span><p>{milestone.deliverable}</p></div></div>
            </div>
          </article>)}
        </div>
      </section>
      <div className="roadmap-support-grid">
        <section className="roadmap-support-card"><span className="roadmap-support-icon"><Clock3 size={17} /></span><div className="tool-eyebrow">WEEKLY RHYTHM</div><h3>Make steady progress</h3><ul>{roadmap.weeklyRhythm.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul></section>
        <section className="roadmap-support-card"><span className="roadmap-support-icon"><Check size={17} /></span><div className="tool-eyebrow">SUCCESS CHECKS</div><h3>Know when it is working</h3><ul>{roadmap.successChecks.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul></section>
      </div>
      <div className="roadmap-disclaimer"><Sparkles size={15} /> AI-generated plan based on the context you provided. Adjust the pace as your priorities change.</div>
    </div>
  );
}

export default function RoadmapGenerator() {
  const [form, setForm] = useState({ goal: '', durationMonths: '6', currentStage: '', hoursPerWeek: '6', background: '', constraints: '' });
  const [roadmap, setRoadmap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);

  function update(field, value) { setForm((previous) => ({ ...previous, [field]: value })); }
  async function generate(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setNoticeIsError(false);
    try {
      const response = await fetch('/api/roadmap/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...form, durationMonths: Number(form.durationMonths), hoursPerWeek: Number(form.hoursPerWeek) }),
        signal: AbortSignal.timeout(55_000),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json();
      if (!result.roadmap?.milestones?.length) throw new Error('The AI response did not contain a valid roadmap. Try again.');
      setRoadmap(result.roadmap);
    } catch (requestError) {
      setError(requestError.name === 'TimeoutError' || requestError.name === 'AbortError'
        ? 'Roadmap generation took too long. Shorten the context or try again.'
        : requestError.message || 'The roadmap could not be generated. Please try again.');
    } finally { setBusy(false); }
  }

  function reset() { setRoadmap(null); setError(''); setNotice(''); setNoticeIsError(false); }

  return <div className="tool-page roadmap-page">
    <ToolHeader active="/roadmap-generator" />
    <main className="tool-main">
      <section className="tool-page-heading">
        <div className="tool-eyebrow">PLANNING TOOL · 02</div>
        <h1>AI Roadmap Generator</h1>
        <p>Turn a goal, a realistic time budget, and your current starting point into a sequenced plan with concrete milestones.</p>
      </section>
      {notice && <div className={`roadmap-notice ${noticeIsError ? 'roadmap-notice-error' : ''}`} role={noticeIsError ? 'alert' : 'status'}>{noticeIsError ? <CircleAlert size={15} /> : <Check size={15} />}{notice}</div>}
      {roadmap ? <RoadmapResult roadmap={roadmap} duration={form.durationMonths} onReset={reset} onNotice={(message, isError = false) => { setNotice(message); setNoticeIsError(isError); }} /> : <div className="roadmap-workspace">
        <form className="roadmap-form-card" onSubmit={generate}>
          <div className="roadmap-form-title"><span><Route size={19} /></span><div><h2>Set your destination</h2><p>Clear context helps Gemini make a more practical plan.</p></div></div>
          <label className="tool-label" htmlFor="roadmap-goal">What do you want to achieve?<span className="tool-required">Required</span></label>
          <textarea id="roadmap-goal" className="tool-input tool-textarea" value={form.goal} onChange={(event) => update('goal', event.target.value)} minLength={3} maxLength={500} required disabled={busy} placeholder="e.g. Become ready to apply for junior front-end developer roles" />
          <div className="roadmap-fields-row">
            <label className="tool-label" htmlFor="roadmap-duration">Plan duration<select id="roadmap-duration" className="tool-input" value={form.durationMonths} onChange={(event) => update('durationMonths', event.target.value)} disabled={busy}>{Array.from({ length: 36 }, (_, i) => i + 1).map((month) => <option key={month} value={month}>{month} {month === 1 ? 'month' : 'months'}</option>)}</select></label>
            <label className="tool-label" htmlFor="roadmap-hours">Available time<input id="roadmap-hours" className="tool-input" type="number" min="1" max="80" value={form.hoursPerWeek} onChange={(event) => update('hoursPerWeek', event.target.value)} required disabled={busy} /><span className="tool-input-suffix">hours / week</span></label>
          </div>
          <label className="tool-label" htmlFor="roadmap-stage">Where are you starting from?<span>Optional</span></label>
          <input id="roadmap-stage" className="tool-input" value={form.currentStage} onChange={(event) => update('currentStage', event.target.value)} maxLength={500} disabled={busy} placeholder="e.g. I know basic HTML and CSS" />
          <label className="tool-label" htmlFor="roadmap-background">Relevant background<span>Optional</span></label>
          <textarea id="roadmap-background" className="tool-input tool-textarea tool-textarea-small" value={form.background} onChange={(event) => update('background', event.target.value)} maxLength={1200} disabled={busy} placeholder="Experience, skills, resources, or other context" />
          <label className="tool-label" htmlFor="roadmap-constraints">Constraints to account for<span>Optional</span></label>
          <textarea id="roadmap-constraints" className="tool-input tool-textarea tool-textarea-small" value={form.constraints} onChange={(event) => update('constraints', event.target.value)} maxLength={1200} disabled={busy} placeholder="Exams, work schedule, budget, access, or other limits" />
          {error && <div className="cv-error" role="alert"><CircleAlert size={16} />{error}</div>}
          <button className="button button-primary roadmap-submit" type="submit" disabled={busy || form.goal.trim().length < 3}>{busy ? <><span className="cv-spinner" /> Building your roadmap…</> : <><Sparkles size={16} /> Generate roadmap <ArrowRight size={15} /></>}</button>
          {busy && <p className="cv-progress-note" role="status">Gemini is organizing your goal into milestones, tasks, and deliverables.</p>}
          <div className="cv-privacy"><ShieldCheckIcon /><span>Your context is used for this request and is not saved by this app.</span></div>
        </form>
        <aside className="roadmap-side-panel"><div className="cv-side-mark">02</div><h2>A plan with<br />room to adapt.</h2><p>Each phase turns your stated goal into manageable work. The plan respects the available time and calls out deliverables you can use to check progress.</p><div className="roadmap-side-facts"><span><b>01</b> Clear milestone sequence</span><span><b>02</b> Tasks sized to your time</span><span><b>03</b> Tangible phase outcomes</span></div></aside>
      </div>}
    </main>
  </div>;
}

function ShieldCheckIcon() { return <span className="roadmap-shield" aria-hidden="true"><Check size={13} /></span>; }
