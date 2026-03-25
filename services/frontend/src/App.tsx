import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { SearchPage } from './pages/SearchPage.js';
import { ProgressPage } from './pages/ProgressPage.js';
import { JobResultsPage } from './pages/JobResultsPage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { DetailPage } from './pages/DetailPage.js';
import { TelemetryPage } from './pages/TelemetryPage.js';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <SearchPage /> },
      { path: '/verify/:jobId', element: <ProgressPage /> },
      { path: '/verify/:jobId/results', element: <JobResultsPage /> },
      { path: '/records', element: <ResultsPage /> },
      { path: '/records/:jobId/:companyNumber', element: <DetailPage /> },
      { path: '/telemetry', element: <TelemetryPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}