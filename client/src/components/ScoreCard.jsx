export function ScoreCard({ label, score, note, icon: Icon, accent = false, unit = '/100', metric = 'score' }) {
  const tone = score == null || metric === 'count' ? 'score-neutral' : score >= 90 ? 'score-good' : score >= 50 ? 'score-warn' : 'score-poor';
  return (
    <article className={`score-card ${accent ? 'score-card-accent' : ''}`}>
      <div className="score-card-top">
        <div className="score-label">{label}</div>
        {Icon ? <span className="score-icon"><Icon size={16} /></span> : null}
      </div>
      <div className={`score-number ${tone}`}>{score == null ? '—' : score}<span>{score == null ? '' : unit}</span></div>
      {metric !== 'count' && score != null && <div className={`score-meter ${tone}`} role="progressbar" aria-label={`${label} score`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={score}><span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div>}
      <div className="score-note">{note || (score == null ? 'Not available' : 'PageSpeed Insights')}</div>
    </article>
  );
}

export function ScoreRing({ score, label = 'Health' }) {
  const value = Number.isFinite(score) ? score : null;
  return (
    <div className={`score-ring ${value == null ? 'score-ring-empty' : value >= 90 ? 'ring-good' : value >= 50 ? 'ring-warn' : 'ring-poor'}`} style={{ '--score': `${value ?? 0}%` }} role="img" aria-label={value == null ? `${label} score unavailable` : `${label} score ${value} out of 100`}>
      <div className="score-ring-inner">
        <span className="ring-value">{value == null ? '—' : value}</span>
        <span className="ring-label">{label}</span>
      </div>
    </div>
  );
}
