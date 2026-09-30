import React from 'react';
import { AlertTriangle, Server, WifiOff } from 'lucide-react';

interface Props {
  sources: Array<{ source_id: string; status: 'available' | 'degraded' | 'unavailable' }>;
}

export const DegradedModeIndicator: React.FC<Props> = ({ sources }) => {
  const problematicSources = sources.filter(s => s.status !== 'available');
  
  if (problematicSources.length === 0) return null;

  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded-r-lg shadow-sm">
      <div className="flex">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-yellow-400" aria-hidden="true" />
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-yellow-800">
            System Operating in Degraded Mode
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            <p>Some data sources are currently experiencing issues. Workflows relying on these sources may fail or timeout.</p>
            <ul className="mt-2 space-y-1">
              {problematicSources.map(source => (
                <li key={source.source_id} className="flex items-center space-x-2 bg-yellow-100 px-2 py-1 rounded w-max">
                  {source.status === 'unavailable' ? (
                    <WifiOff className="w-3 h-3 text-red-500" />
                  ) : (
                    <Server className="w-3 h-3 text-yellow-600" />
                  )}
                  <span className="font-mono font-medium">{source.source_id}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    source.status === 'unavailable' ? 'bg-red-100 text-red-800' : 'bg-yellow-200 text-yellow-800'
                  }`}>
                    {source.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
