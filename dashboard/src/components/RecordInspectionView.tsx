import React, { useState } from 'react';
import type { RecordInspection } from '../types';
import { Eye, ShieldCheck } from 'lucide-react';

interface Props {
  inspection?: RecordInspection;
}

export const RecordInspectionView: React.FC<Props> = ({ inspection }) => {
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  if (!inspection) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Record Inspection</h2>
        <span className="text-sm bg-gray-100 px-3 py-1 rounded-full font-medium">
          Total: {inspection.total_records.toLocaleString()}
        </span>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 border">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Preview</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provenance</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {inspection.records.map((record, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{String(record.id ?? idx)}</td>
                <td className="px-6 py-4 text-sm text-gray-800">
                  <div className="truncate max-w-xs">{JSON.stringify(record).substring(0, 50)}...</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {record._provenance ? (
                    <div className="flex flex-col text-xs text-green-600">
                      <div className="flex items-center space-x-1">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Conf: {(Number((record._provenance as Record<string, unknown>).extraction_confidence) * 100).toFixed(1)}%</span>
                      </div>
                      <span className="text-gray-500 truncate max-w-[150px]" title={String((record._provenance as Record<string, unknown>).source_url)}>
                        {String((record._provenance as Record<string, unknown>).source_url)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">None</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button 
                    onClick={() => setSelectedRecord(record)}
                    className="text-blue-600 hover:text-blue-900 flex items-center justify-end space-x-1 ml-auto"
                  >
                    <Eye className="w-4 h-4" /> <span>View</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-semibold mb-4">Record Details</h3>
            <div className="bg-gray-900 rounded p-4 overflow-auto flex-1 text-green-400 font-mono text-sm">
              <pre>{JSON.stringify(selectedRecord, null, 2)}</pre>
            </div>
            <div className="mt-4 flex justify-end">
              <button 
                onClick={() => setSelectedRecord(null)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
