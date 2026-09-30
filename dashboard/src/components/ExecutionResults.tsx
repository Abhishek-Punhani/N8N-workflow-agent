import React from 'react';
import type { ExecutionResult } from '../types';
import { CheckCircle2, XCircle, Activity, Loader2 } from 'lucide-react';

interface Props {
  executions: ExecutionResult[];
}

export const ExecutionResults: React.FC<Props> = ({ executions }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'stalled': return <Activity className="w-5 h-5 text-yellow-500" />;
      case 'running': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return null;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Execution Results</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Execution ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Workflow ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Records</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {executions.map((exec) => (
              <tr key={exec.execution_id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(exec.status)}
                    <span className="capitalize">{exec.status}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{exec.execution_id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{exec.workflow_id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{exec.records_processed.toLocaleString()}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {exec.duration_ms ? `${(exec.duration_ms / 1000).toFixed(1)}s` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
