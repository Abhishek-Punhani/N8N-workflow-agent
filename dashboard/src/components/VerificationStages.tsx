import React from 'react';
import { CheckCircle2, CircleDashed, XCircle, Clock } from 'lucide-react';
import type { VerificationStage } from '../types';

interface Props {
  stages: VerificationStage[];
}

export const VerificationStages: React.FC<Props> = ({ stages }) => {
  const getIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <CircleDashed className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Verification Stages</h2>
      <div className="flex flex-col space-y-4">
        {stages.map((stage, idx) => (
          <div key={idx} className="flex items-center justify-between border-b pb-2 last:border-0">
            <div className="flex items-center space-x-3">
              {getIcon(stage.status)}
              <span className="font-medium text-gray-700">{stage.stage_name}</span>
            </div>
            <div className="text-sm text-gray-500">
              {stage.status.charAt(0).toUpperCase() + stage.status.slice(1)}
              {stage.timestamp && ` at ${new Date(stage.timestamp).toLocaleTimeString()}`}
            </div>
            {stage.message && (
              <div className="text-sm text-red-600 mt-1 w-full">{stage.message}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
