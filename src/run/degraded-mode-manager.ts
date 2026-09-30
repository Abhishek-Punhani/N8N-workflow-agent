/**
 * AI Data Intelligence Platform - Degraded Mode Manager
 *
 * Tracks data source availability, manages degraded mode state, and provides
 * status reporting for the Dashboard (Req 13.6).
 *
 * When EXTERNAL_SOURCE_FAILURE occurs the orchestrator calls markDegraded()
 * on the affected source. Subsequent workflow planning uses getAvailableSources()
 * to skip unavailable sources and continue with what remains (Req 13.4).
 *
 * Requirements: 7.6, 13.4, 13.6
 */

import type { DegradedSource, DegradedModeConfig } from './types.js';

// ============================================================================
// DegradedModeManager class
// ============================================================================

/**
 * DegradedModeManager tracks which data sources are degraded or unavailable
 * and exposes status information for orchestration and Dashboard display.
 *
 * Requirements: 7.6, 13.4, 13.6
 */
export class DegradedModeManager {
  private readonly config: DegradedModeConfig;

  constructor(config?: Partial<DegradedModeConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      allow_partial_results: config?.allow_partial_results ?? true,
      sources: config?.sources ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // Source registration
  // -------------------------------------------------------------------------

  /**
   * Register a source as available (known but healthy).
   * Must be called before marking a source degraded if you want
   * full tracking of `source_type`.
   */
  public registerSource(source: Omit<DegradedSource, 'status'>): void {
    this.config.sources[source.source_id] = {
      ...source,
      status: 'available',
    };
  }

  // -------------------------------------------------------------------------
  // Status updates — called by the orchestrator on failure classification
  // -------------------------------------------------------------------------

  /**
   * Mark a source as degraded after an EXTERNAL_SOURCE_FAILURE.
   * Records the last available timestamp for observability (Req 13.6).
   *
   * If the source was not previously registered it is auto-registered
   * with source_type 'unknown'.
   */
  public markDegraded(sourceId: string): void {
    const existing = this.config.sources[sourceId];
    this.config.sources[sourceId] = {
      source_id: sourceId,
      source_type: existing?.source_type ?? 'unknown',
      last_available: new Date().toISOString(),
      status: 'degraded',
    };
  }

  /**
   * Mark a source as fully unavailable (stronger than degraded — no fallback).
   */
  public markUnavailable(sourceId: string): void {
    const existing = this.config.sources[sourceId];
    this.config.sources[sourceId] = {
      source_id: sourceId,
      source_type: existing?.source_type ?? 'unknown',
      last_available: existing?.last_available,
      status: 'unavailable',
    };
  }

  /**
   * Restore a source to available (e.g. after a health-check passes).
   */
  public markAvailable(sourceId: string): void {
    const existing = this.config.sources[sourceId];
    if (existing) {
      this.config.sources[sourceId] = { ...existing, status: 'available' };
    }
  }

  // -------------------------------------------------------------------------
  // Availability queries
  // -------------------------------------------------------------------------

  /**
   * Whether degraded mode is currently active (at least one non-available source).
   * Req 13.6: Dashboard uses this to show the degraded indicator.
   */
  public isActive(): boolean {
    return Object.values(this.config.sources).some(s => s.status !== 'available');
  }

  /**
   * Whether a specific source is available for use.
   * Sources not registered are assumed available (open-world assumption).
   */
  public isAvailable(sourceId: string): boolean {
    const source = this.config.sources[sourceId];
    if (!source) return true; // unregistered = assumed available
    return source.status === 'available';
  }

  /**
   * Whether a specific source is degraded.
   */
  public isDegraded(sourceId: string): boolean {
    return this.config.sources[sourceId]?.status === 'degraded';
  }

  /**
   * Whether a specific source is fully unavailable.
   */
  public isUnavailable(sourceId: string): boolean {
    return this.config.sources[sourceId]?.status === 'unavailable';
  }

  // -------------------------------------------------------------------------
  // Reporting — used by orchestrator and Dashboard (Req 13.6)
  // -------------------------------------------------------------------------

  /**
   * Return all sources that are not currently available.
   * Req 13.6: Dashboard displays this list when degraded mode is active.
   */
  public getAffectedSources(): DegradedSource[] {
    return Object.values(this.config.sources).filter(s => s.status !== 'available');
  }

  /**
   * Return all sources that are currently available.
   * Req 13.4: Used by the orchestrator to continue with available sources.
   */
  public getAvailableSources(): DegradedSource[] {
    return Object.values(this.config.sources).filter(s => s.status === 'available');
  }

  /**
   * Return all tracked sources with their current status.
   * Full snapshot for Dashboard display.
   */
  public getAllSources(): DegradedSource[] {
    return Object.values(this.config.sources);
  }

  /**
   * Return a flat status report suitable for Dashboard display (Req 13.6).
   * Shape matches what the Dashboard expects: isActive flag + affected list.
   */
  public getStatusReport(): {
    degraded_mode_active: boolean;
    affected_sources: DegradedSource[];
    available_source_count: number;
    total_source_count: number;
  } {
    const all = this.getAllSources();
    const affected = this.getAffectedSources();
    return {
      degraded_mode_active: this.isActive(),
      affected_sources: affected,
      available_source_count: all.length - affected.length,
      total_source_count: all.length,
    };
  }

  /**
   * Reset all sources back to available.
   * Useful between workflow runs or after a full recovery.
   */
  public reset(): void {
    for (const id of Object.keys(this.config.sources)) {
      this.config.sources[id].status = 'available';
    }
  }

  /**
   * Return the raw config snapshot (for serialisation / persistence).
   */
  public getConfig(): Readonly<DegradedModeConfig> {
    return this.config;
  }
}
