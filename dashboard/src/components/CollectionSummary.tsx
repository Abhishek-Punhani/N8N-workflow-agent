import type { ExecutionResult } from '../types';

export function CollectionSummary({
  collection,
  onRetry,
  busy,
}: {
  collection?: ExecutionResult['collection'];
  onRetry?: () => void;
  busy?: boolean;
}) {
  if (!collection) return null;
  const unavailable = collection.sources.filter(
    source => !['available', 'redirected'].includes(source.state)
  );
  return (
    <section className="collection-summary" aria-label="Source collection">
      <h2>
        {collection.coverage === 'partial'
          ? 'Partial collection'
          : collection.phase === 'finished'
            ? 'Collection coverage'
            : 'Exploring sources'}
      </h2>
      <p>
        {collection.pages_visited} pages inspected · {collection.accepted_records}
        {collection.requested_records ? ` of ${collection.requested_records}` : ''} records accepted
      </p>
      {collection.warnings.map((warning, index) => (
        <p className="collection-warning" key={index}>
          {warning}
        </p>
      ))}
      {unavailable.length > 0 && (
        <details>
          <summary>{unavailable.length} sources could not be collected</summary>
          <ul>
            {unavailable.map((source, index) => (
              <li key={index}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {new URL(source.url).hostname}
                </a>
                <span>
                  {source.state.replaceAll('_', ' ')}: {source.message}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {collection.sources.length > 0 && (
        <details>
          <summary>Inspect visited sources</summary>
          <ul>
            {collection.sources.map((source, index) => (
              <li key={index}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.url}
                </a>
                <span>
                  {source.state.replaceAll('_', ' ')} · {source.records} candidate records
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {onRetry && (
        <button className="text-button" disabled={busy} onClick={onRetry}>
          Resume collection with a fresh budget
        </button>
      )}
    </section>
  );
}

export function EvidenceDetails({ provenance }: { provenance: Record<string, unknown> }) {
  const fields = provenance.field_evidence;
  if (!fields || typeof fields !== 'object') return null;
  return (
    <section className="field-evidence">
      <h3>Evidence for each field</h3>
      {Object.entries(fields).map(([field, value]) => {
        if (!value || typeof value !== 'object') return null;
        const evidence = value as Record<string, unknown>;
        return (
          <div key={field}>
            <strong>{field.replaceAll('_', ' ')}</strong>
            <blockquote>{String(evidence.quote ?? '')}</blockquote>
            {/^https:\/\//.test(String(evidence.source_url)) && (
              <a href={String(evidence.source_url)} target="_blank" rel="noopener noreferrer">
                View field source
              </a>
            )}
            <small>Retrieved {new Date(String(evidence.retrieved_at)).toLocaleString()}</small>
          </div>
        );
      })}
    </section>
  );
}
