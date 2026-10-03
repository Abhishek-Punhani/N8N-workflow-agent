import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CollectionSummary } from '../CollectionSummary';
import type { ExecutionResult } from '../../types';

const collection: NonNullable<ExecutionResult['collection']> = {
  phase: 'finished',
  coverage: 'partial',
  accepted_records: 1,
  requested_records: 3,
  pages_visited: 12,
  model_calls: 20,
  stop_reason: 'page_budget',
  sources: [],
  warnings: [],
  budgets: { pages: 12, model_calls: 40, seconds: 300 },
  elapsed_ms: 213000,
  queued_sources: 8,
  queries: ['additional qualifying companies'],
  candidate_issues: [{ entity: 'Example', issues: ['Founder role has no supporting evidence'] }],
};
describe('Collection transparency', () => {
  it('shows the shortfall, stopping reason, limits and missing evidence', () => {
    render(<CollectionSummary collection={collection} />);
    expect(screen.getByText(/The source-attempt limit was reached/)).toBeInTheDocument();
    expect(screen.getByText(/dataset is incomplete/)).toBeInTheDocument();
    expect(screen.getByText('12 / 12')).toBeInTheDocument();
    expect(screen.getByText('Founder role has no supporting evidence')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
  });
  it('shows the current action while collecting', () => {
    render(
      <CollectionSummary
        collection={{
          ...collection,
          phase: 'collecting',
          coverage: 'in_progress',
          activity: {
            at: '2026-10-03T10:00:00Z',
            kind: 'verifying',
            message: 'Checking founder relationship',
          },
        }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Checking founder relationship');
  });
});
