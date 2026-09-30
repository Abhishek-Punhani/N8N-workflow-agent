import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VerificationStages } from '../VerificationStages';
import { ExecutionResults } from '../ExecutionResults';
import { RecordInspectionView } from '../RecordInspectionView';
import { ExportManager } from '../ExportManager';
import { DegradedModeIndicator } from '../DegradedModeIndicator';

describe('Dashboard Integration Tests', () => {
  it('VerificationStages: displays correctly', () => {
    const stages = [
      { name: 'Intake', status: 'completed' as const },
      { name: 'Plan', status: 'completed' as const },
      { name: 'Verify', status: 'failed' as const, errors: ['Structural error'] },
    ];
    
    render(<VerificationStages stages={stages} />);
    
    expect(screen.getByText('Verification Stages')).toBeInTheDocument();
    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Verify')).toBeInTheDocument();
    expect(screen.getByText('Structural error')).toBeInTheDocument();
  });

  it('ExecutionResults: displays records and duration', () => {
    const executions = [
      {
        execution_id: 'exec-1',
        workflow_id: 'wf-1',
        status: 'completed',
        records_processed: 100,
        duration_ms: 1500,
        started_at: '2023-01-01T00:00:00Z',
        completed_at: '2023-01-01T00:00:01Z'
      }
    ];

    render(<ExecutionResults executions={executions} />);
    
    expect(screen.getByText('Execution Results')).toBeInTheDocument();
    expect(screen.getByText('exec-1')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('RecordInspectionView: renders records and handles modal', () => {
    const inspection = {
      total_records: 1,
      page: 1,
      page_size: 10,
      records: [
        { id: '1', name: 'Test Record', _provenance: { source_url: 'http://test.com', extraction_confidence: 0.95 } }
      ]
    };

    render(<RecordInspectionView inspection={inspection} />);
    
    expect(screen.getByText(/Total: 1/)).toBeInTheDocument();
    expect(screen.getByText('http://test.com')).toBeInTheDocument();
    expect(screen.getByText('Conf: 95.0%')).toBeInTheDocument();

    const viewButton = screen.getByText('View');
    fireEvent.click(viewButton);

    expect(screen.getByText('Record Details')).toBeInTheDocument();
    expect(screen.getByText(/Test Record/)).toBeInTheDocument();
    
    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);
    expect(screen.queryByText('Record Details')).not.toBeInTheDocument();
  });

  it('ExportManager: handles export triggering', () => {
    const options = {
      formats: ['csv', 'json'],
      max_records: 1000000,
      max_size_mb: 500
    };

    render(<ExportManager options={options} />);
    
    expect(screen.getByText('Data Export')).toBeInTheDocument();
    
    // Default format should be CSV
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('csv');
    
    // Change format
    fireEvent.change(select, { target: { value: 'json' } });
    expect(select).toHaveValue('json');
    
    const button = screen.getByRole('button', { name: /Export/i });
    expect(button).not.toBeDisabled();
  });

  it('DegradedModeIndicator: shows degraded sources', () => {
    const sources = [
      {
        source_id: 'db-1',
        source_name: 'Primary Database',
        status: 'degraded' as const,
        last_successful_sync: '2023-01-01T00:00:00Z'
      }
    ];

    render(<DegradedModeIndicator sources={sources} />);
    
    expect(screen.getByText(/Degraded Mode Active/i)).toBeInTheDocument();
    expect(screen.getByText('Primary Database')).toBeInTheDocument();
    expect(screen.getByText(/degraded/i)).toBeInTheDocument();
  });
});
