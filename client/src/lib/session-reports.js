const SESSION_REPORTS_KEY = 'sitesense.scanReports.v1';
const MAX_SESSION_REPORTS = 50;

export function getSessionReports() {
  try {
    const reports = JSON.parse(window.sessionStorage.getItem(SESSION_REPORTS_KEY) || '[]');
    return Array.isArray(reports) ? reports.filter((report) => report && typeof report.id === 'string' && typeof report.url === 'string') : [];
  } catch {
    return [];
  }
}

export function getSessionReport(id) {
  return getSessionReports().find((report) => report.id === id) ?? null;
}

export function saveSessionReport(scan) {
  const id = scan.id || globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const report = { ...scan, id, sessionOnly: true };
  let reports = [report, ...getSessionReports().filter((item) => item.id !== id)].slice(0, MAX_SESSION_REPORTS);
  while (reports.length) {
    try {
      window.sessionStorage.setItem(SESSION_REPORTS_KEY, JSON.stringify(reports));
      break;
    } catch {
      reports = reports.slice(0, -1);
    }
  }
  return report;
}
