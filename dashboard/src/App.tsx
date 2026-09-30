import { useEffect, useState } from 'react';
import type { DashboardView } from './types';
import { fetchDashboardData } from './api';
import { VerificationStages } from './components/VerificationStages';
import { ExecutionResults } from './components/ExecutionResults';
import { RecordInspectionView } from './components/RecordInspectionView';
import { ExportManager } from './components/ExportManager';
import { DegradedModeIndicator } from './components/DegradedModeIndicator';
import { Database, LayoutDashboard } from 'lucide-react';

function App() {
  const [data, setData] = useState<DashboardView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData().then(dashboardData => {
      setData(dashboardData);
      setLoading(false);
    });
  }, []);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Database className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">
                AI Data Intelligence Platform
              </h1>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-500 font-medium">
              <LayoutDashboard className="h-4 w-4" />
              <span>Operations Dashboard</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {data.degraded_sources && (
          <DegradedModeIndicator sources={data.degraded_sources} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-1">
            <VerificationStages stages={data.verification_stages} />
          </div>
          <div className="lg:col-span-2">
            <ExecutionResults executions={data.execution_results} />
          </div>
        </div>

        <RecordInspectionView inspection={data.record_inspection} />
        
        <ExportManager options={data.export_options} />
      </main>
    </div>
  );
}

export default App;
