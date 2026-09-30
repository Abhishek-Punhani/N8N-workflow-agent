/**
 * AI Data Intelligence Platform - Provenance System
 *
 * Task 6.1 — Enriches workflow output records with source traceability
 * and quality metadata (source_url, extraction_confidence, dedupe_group,
 * validation_status), deduplicates by content fingerprint (SHA-256), and
 * enforces source_url presence when required.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { createHash } from 'crypto';
import type { ProvenanceMetadata, RecordWithProvenance, ValidationStatus } from '../core/types.js';
import { ValidationError } from '../core/errors.js';

// ============================================================================
// Public API types
// ============================================================================

export interface EnrichInput {
  /** Records to enrich. */
  records: Record<string, any>[];
  /**
   * Source URL applied to all records.
   * Use null to explicitly signal no URL is available.
   * Omit to use any existing _provenance.source_url on the record itself.
   */
  source_url?: string | null;
  /**
   * Extraction confidence in [0.0, 1.0].
   * @default 1.0
   */
  extraction_confidence?: number;
  /**
   * When true, records that cannot resolve a non-null source_url are
   * rejected rather than enriched.
   * @default false
   */
  require_source_url?: boolean;
}

export interface EnrichOutput {
  /** Records that passed all checks and have been enriched with _provenance. */
  enriched: RecordWithProvenance[];
  /** Records that were rejected (e.g. missing required source_url). */
  rejected: Array<{ record: Record<string, any>; reason: string }>;
  /** Deduplication statistics. */
  deduplication: {
    original_count: number;
    duplicate_count: number;
    final_count: number;
  };
}

// ============================================================================
// ProvenanceSystem
// ============================================================================

export class ProvenanceSystem {
  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Recursively canonicalize an object by sorting keys.
   * Strips any existing `_provenance` field so dedupe is based on data only.
   */
  private canonicalize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.canonicalize(item));
    }
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj)
      .filter(k => k !== '_provenance')
      .sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = this.canonicalize(obj[key]);
    }
    return result;
  }

  /** Compute SHA-256 dedupe fingerprint for a record (ignoring _provenance). */
  private computeDedupeGroup(record: Record<string, any>): string {
    const canonical = this.canonicalize(record);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /** Round confidence to at most 4 decimal places (Requirement 11.5). */
  private formatConfidence(confidence: number): number {
    return Math.round(confidence * 10000) / 10000;
  }

  /**
   * Determine validation_status for a record.
   * Currently: 'invalid:missing_field' when source is required but absent;
   * 'valid' otherwise. Future: type/constraint checks can extend this.
   */
  private determineValidationStatus(
    record: Record<string, any>,
    resolvedSourceUrl: string | null,
    requireSourceUrl: boolean
  ): ValidationStatus {
    if (requireSourceUrl && !resolvedSourceUrl) {
      return 'invalid:missing_field';
    }
    // Detect null/undefined values in top-level required-looking fields
    const hasNullRequiredField = Object.values(record).some(v => v === null || v === undefined);
    if (hasNullRequiredField) {
      return 'invalid:missing_field';
    }
    return 'valid';
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Enrich records with provenance metadata, deduplicate by content hash,
   * and optionally reject records missing a required source_url.
   *
   * @throws {ValidationError} if extraction_confidence is outside [0.0, 1.0].
   */
  public enrich(input: EnrichInput): EnrichOutput {
    const {
      records,
      source_url = undefined,
      extraction_confidence = 1.0,
      require_source_url = false,
    } = input;

    // Validate extraction_confidence range (Requirement 11.5)
    if (
      typeof extraction_confidence !== 'number' ||
      isNaN(extraction_confidence) ||
      extraction_confidence < 0.0 ||
      extraction_confidence > 1.0
    ) {
      throw new ValidationError(
        `extraction_confidence must be a number in [0.0, 1.0], got: ${String(extraction_confidence)}`,
        { extraction_confidence },
        false
      );
    }

    const formattedConfidence = this.formatConfidence(extraction_confidence);
    const originalCount = records.length;
    const rejected: Array<{ record: Record<string, any>; reason: string }> = [];
    const candidates: RecordWithProvenance[] = [];

    // ---- Step 1: Source URL resolution + metadata attachment ----
    for (const record of records) {
      // Resolve source URL: explicit input takes priority, then record's existing provenance
      let resolvedUrl: string | null;
      if (source_url !== undefined) {
        resolvedUrl = source_url;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const existing = (record['_provenance'] as Record<string, unknown> | undefined)?.[
          'source_url'
        ];
        resolvedUrl = typeof existing === 'string' ? existing : null;
      }

      // Requirement 11.3: reject if source_url required but absent
      if (require_source_url && !resolvedUrl) {
        rejected.push({ record, reason: 'Missing required source_url' });
        continue;
      }

      const dedupeGroup = this.computeDedupeGroup(record);
      const validationStatus = this.determineValidationStatus(record, resolvedUrl, false);

      const provenance: ProvenanceMetadata = {
        source_url: resolvedUrl,
        extraction_confidence: formattedConfidence,
        dedupe_group: dedupeGroup,
        validation_status: validationStatus,
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const enriched: RecordWithProvenance = { ...record, _provenance: provenance };
      candidates.push(enriched);
    }

    // ---- Step 2: Deduplication (Requirement 11.4) ----
    // Keep one record per dedupe_group — the one with highest extraction_confidence.
    const dedupeMap = new Map<string, RecordWithProvenance>();
    for (const candidate of candidates) {
      const group = candidate._provenance.dedupe_group;
      const existing = dedupeMap.get(group);
      if (
        !existing ||
        candidate._provenance.extraction_confidence > existing._provenance.extraction_confidence
      ) {
        dedupeMap.set(group, candidate);
      }
    }

    const enrichedRecords = Array.from(dedupeMap.values());
    const duplicateCount = candidates.length - enrichedRecords.length;

    return {
      enriched: enrichedRecords,
      rejected,
      deduplication: {
        original_count: originalCount,
        duplicate_count: duplicateCount,
        final_count: enrichedRecords.length,
      },
    };
  }
}
