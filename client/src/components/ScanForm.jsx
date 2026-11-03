import { useState } from 'react';
import { ArrowRight, Globe2, LoaderCircle, Smartphone, Monitor } from 'lucide-react';
import { createScan, getErrorMessage } from '../lib/api.js';
import { useToast } from './ToastProvider.jsx';

export default function ScanForm({ initialUrl = '', compact = false, onComplete, onLoadingChange, onProgress }) {
  const { notify } = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [device, setDevice] = useState('mobile');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    onProgress?.({ stage: 'reset', status: 'running', message: 'Starting a new scan.' });
    setLoading(true);
    onLoadingChange?.(true);
    try {
      const scan = await createScan({ url: url.trim(), device }, onProgress);
      if (scan.status === 'partial') notify('Scan finished with some unavailable services. Review the report for details.', 'info');
      else if (scan.persisted === false) notify('Scan complete. The report is available for this session.', 'success');
      else notify('Scan complete and report saved.', 'success');
      onComplete?.(scan);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      notify(getErrorMessage(requestError), 'error');
      onProgress?.({ stage: 'error', status: 'error', message: getErrorMessage(requestError) });
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  return (
    <form className={`scan-form ${compact ? 'scan-form-compact' : ''}`} onSubmit={submit}>
      <label className="field-label" htmlFor={compact ? 'quick-url' : 'scan-url'}>Website URL</label>
      <div className="url-control">
        <span className="url-prefix"><Globe2 size={15} /></span>
        <input
          id={compact ? 'quick-url' : 'scan-url'}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example.com or https://example.com"
          autoComplete="url"
          required
          disabled={loading}
        />
      </div>
      <div className="scan-form-actions">
        {!compact && (
          <div className="device-select" role="group" aria-label="Analysis device">
            <button type="button" className={device === 'mobile' ? 'device-option selected' : 'device-option'} onClick={() => setDevice('mobile')} disabled={loading}>
              <Smartphone size={15} /> Mobile
            </button>
            <button type="button" className={device === 'desktop' ? 'device-option selected' : 'device-option'} onClick={() => setDevice('desktop')} disabled={loading}>
              <Monitor size={15} /> Desktop
            </button>
          </div>
        )}
        <button type="submit" className={`button button-primary ${compact ? 'button-compact' : ''}`} disabled={loading || !url.trim()}>
          {loading ? <><LoaderCircle className="spin" size={16} /> Scanning</> : <>{compact ? 'Run scan' : 'Start scan'} <ArrowRight size={16} /></>}
        </button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </form>
  );
}
