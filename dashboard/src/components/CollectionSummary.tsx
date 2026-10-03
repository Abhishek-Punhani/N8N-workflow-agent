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
  const reasons: Record<string, string> = {
    page_budget: 'The source-attempt limit was reached.',
    model_budget: 'The model-call limit was reached.',
    time_budget: 'The collection time limit was reached.',
    sources_exhausted: 'No unvisited relevant sources remain after discovery.',
    model_unavailable: 'The configured model could not continue.',
    requested_count_reached: 'The requested number of records passed validation.',
  };
  const finished = collection.phase === 'finished';
  const elapsedMs =
    !finished && collection.started_at
      ? Math.max(0, Date.now() - Date.parse(collection.started_at))
      : (collection.elapsed_ms ?? 0);
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
        {collection.pages_visited} source attempts · {collection.accepted_records}
        {collection.requested_records ? ` of ${collection.requested_records}` : ''} records accepted
      </p>
      {collection.requested_records && (
        <progress
          className="collection-progress"
          aria-label="Requested records collected"
          value={collection.accepted_records}
          max={collection.requested_records}
        />
      )}
      {finished && collection.stop_reason && (
        <p className="collection-outcome">
          {reasons[collection.stop_reason] ?? collection.stop_reason.replaceAll('_', ' ')}
          {collection.coverage === 'partial' &&
            ' The dataset is incomplete; passing the workflow checks does not mean the requested count was reached.'}
        </p>
      )}
      {collection.budgets && (
        <div className="collection-metrics">
          <span>
            <strong>
              {collection.pages_visited} / {collection.budgets.pages}
            </strong>{' '}
            source attempts
          </span>
          <span>
            <strong>
              {collection.model_calls ?? 0} / {collection.budgets.model_calls}
            </strong>{' '}
            model calls
          </span>
          <span>
            <strong>
              {Math.round(elapsedMs / 1000)} / {collection.budgets.seconds}s
            </strong>{' '}
            collection time
          </span>
          <span>
            <strong>{collection.queued_sources ?? 0}</strong> sources queued
          </span>
        </div>
      )}
      {!finished && collection.activity && (
        <div className="collection-current" role="status">
          <strong>{collection.activity.kind.replaceAll('_', ' ')}</strong>
          <span>{collection.activity.message}</span>
          {collection.activity.url && (
            <a href={collection.activity.url} target="_blank" rel="noopener noreferrer">
              {collection.activity.url}
            </a>
          )}
        </div>
      )}
      {!!collection.events?.length && (
        <details open>
          <summary>Collection activity</summary>
          <ol className="collection-events">
            {collection.events
              .slice(-10)
              .reverse()
              .map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
                  <div>
                    <strong>{event.kind.replaceAll('_', ' ')}</strong>
                    <span>{event.message}</span>
                    {event.url && (
                      <a href={event.url} target="_blank" rel="noopener noreferrer">
                        {event.url}
                      </a>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        </details>
      )}
      {!!collection.candidate_issues?.length && (
        <details open>
          <summary>Candidates needing more evidence ({collection.candidate_issues.length})</summary>
          <ul>
            {collection.candidate_issues.map((candidate, index) => (
              <li key={index}>
                <strong>{candidate.entity}</strong>
                <span>
                  {candidate.issues.length
                    ? candidate.issues.join('; ')
                    : 'Waiting for evidence review'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!collection.requirements?.length && (
        <details>
          <summary>What a record must satisfy</summary>
          <ul>
            {collection.requirements.map((requirement, index) => (
              <li key={index}>{requirement}</li>
            ))}
          </ul>
        </details>
      )}
      {!!collection.queries?.length && (
        <details>
          <summary>Search queries ({collection.queries.length})</summary>
          <ol>
            {collection.queries.map(query => (
              <li key={query}>{query}</li>
            ))}
          </ol>
        </details>
      )}
      {!!collection.warnings.length && (
        <details>
          <summary>Source access and provider notices ({collection.warnings.length})</summary>
          {collection.warnings.map((warning, index) => (
            <p className="collection-warning" key={index}>
              {warning}
            </p>
          ))}
        </details>
      )}
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
          Continue from saved progress
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
      {!!provenance.evidence_review && typeof provenance.evidence_review === 'object' && (
        <p>
          {(provenance.evidence_review as Record<string, unknown>).method ===
          'model_evidence_review'
            ? 'Source context was reviewed for entity, field relationships and requested qualifications. This checks published evidence; it is not independent verification of the source’s truthfulness.'
            : 'Values were copied from the supplied JSON source and schema checked.'}
        </p>
      )}
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
