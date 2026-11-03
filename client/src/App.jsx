import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
const ProjectHub = lazy(() => import('./pages/ProjectHub.jsx'));
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Scanner = lazy(() => import('./pages/Scanner.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Report = lazy(() => import('./pages/Report.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const CvChecker = lazy(() => import('../../ai-cv-cheker/client/CvChecker.jsx'));
const RoadmapGenerator = lazy(() => import('../../ai-road-map-generator/client/RoadmapGenerator.jsx'));

function Workspace({ children }) { return <AppShell>{children}</AppShell>; }

export default function App() {
  return (
    <Suspense fallback={<div className="route-loading" role="status"><span className="cv-spinner" /> Loading project…</div>}>
    <Routes>
      <Route path="/" element={<ProjectHub />} />
      <Route path="/cv-checker" element={<CvChecker />} />
      <Route path="/roadmap-generator" element={<RoadmapGenerator />} />
      <Route path="/sitesense" element={<Landing />} />
      <Route path="/dashboard" element={<Workspace><Dashboard /></Workspace>} />
      <Route path="/scan" element={<Workspace><Scanner /></Workspace>} />
      <Route path="/history" element={<Workspace><History /></Workspace>} />
      <Route path="/settings" element={<Workspace><Settings /></Workspace>} />
      <Route path="/reports/:id" element={<Workspace><Report /></Workspace>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
