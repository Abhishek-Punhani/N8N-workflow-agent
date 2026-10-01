import React, { useState } from 'react';
import { triggerExport } from '../api';
import type { ExportOptions } from '../types';
import { Download, FileJson, FileSpreadsheet } from 'lucide-react';

interface Props {
  options: ExportOptions;
  executionId?: string;
}

export const ExportManager: React.FC<Props> = ({ options, executionId }) => {
  const [format, setFormat] = useState<'csv' | 'json'>('json');
  const [isExporting, setIsExporting] = useState(false);

  const [error, setError] = useState('');
  const handleExport = async () => {
    if (!executionId) return;
    setIsExporting(true); setError('');
    try {
      const { download_url } = await triggerExport(executionId, format);
      window.location.assign(download_url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed'); }
    finally { setIsExporting(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center">
        <Download className="w-5 h-5 mr-2" />
        Data Export
      </h2>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-col sm:flex-row sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Format:</label>
          <div className="flex space-x-2">
            {options.available_formats.includes('json') && (
              <button
                onClick={() => setFormat('json')}
                className={`flex items-center px-3 py-1.5 rounded-md border text-sm ${
                  format === 'json' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <FileJson className="w-4 h-4 mr-1" /> JSON
              </button>
            )}
            {options.available_formats.includes('csv') && (
              <button
                onClick={() => setFormat('csv')}
                className={`flex items-center px-3 py-1.5 rounded-md border text-sm ${
                  format === 'csv' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 mr-1" /> CSV
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 flex-1">
          <p>Limits: Max {options.max_records.toLocaleString()} records, {options.max_size_mb}MB</p>
        </div>

        <button
          onClick={() => void handleExport()}
          disabled={isExporting || !executionId}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-md font-medium flex items-center justify-center transition-colors shadow-sm"
        >
          {isExporting ? 'Exporting...' : 'Start Export'}
        </button>
      </div>
    </div>
  );
};
