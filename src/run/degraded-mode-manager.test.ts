/**
 * AI Data Intelligence Platform - DegradedModeManager Tests
 *
 * Requirements: 7.6, 13.4, 13.6
 */

import { DegradedModeManager } from './degraded-mode-manager.js';

describe('DegradedModeManager', () => {
  let mgr: DegradedModeManager;

  beforeEach(() => {
    mgr = new DegradedModeManager();
  });

  // -------------------------------------------------------------------------
  // isActive
  // -------------------------------------------------------------------------

  it('isActive is false when no sources are tracked', () => {
    expect(mgr.isActive()).toBe(false);
  });

  it('isActive is false when all registered sources are available', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    expect(mgr.isActive()).toBe(false);
  });

  it('isActive is true after marking a source degraded', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    mgr.markDegraded('s1');
    expect(mgr.isActive()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // markDegraded / isDegraded
  // -------------------------------------------------------------------------

  it('markDegraded sets status to degraded', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    mgr.markDegraded('s1');
    expect(mgr.isDegraded('s1')).toBe(true);
  });

  it('markDegraded records last_available timestamp', () => {
    mgr.markDegraded('s1');
    const src = mgr.getAllSources().find(s => s.source_id === 's1')!;
    expect(src.last_available).toBeDefined();
    expect(isNaN(new Date(src.last_available!).getTime())).toBe(false);
  });

  it('auto-registers an unknown source when markDegraded is called', () => {
    mgr.markDegraded('new-source');
    expect(mgr.isDegraded('new-source')).toBe(true);
  });

  it('markDegraded sets source_type to "unknown" for auto-registered sources', () => {
    mgr.markDegraded('auto');
    const src = mgr.getAllSources().find(s => s.source_id === 'auto')!;
    expect(src.source_type).toBe('unknown');
  });

  // -------------------------------------------------------------------------
  // markUnavailable / isUnavailable
  // -------------------------------------------------------------------------

  it('markUnavailable sets status to unavailable', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    mgr.markUnavailable('s1');
    expect(mgr.isUnavailable('s1')).toBe(true);
    expect(mgr.isDegraded('s1')).toBe(false);
  });

  it('markUnavailable also makes isActive true', () => {
    mgr.markUnavailable('s1');
    expect(mgr.isActive()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // markAvailable / restore
  // -------------------------------------------------------------------------

  it('markAvailable restores a degraded source', () => {
    mgr.markDegraded('s1');
    mgr.markAvailable('s1');
    expect(mgr.isDegraded('s1')).toBe(false);
    expect(mgr.isAvailable('s1')).toBe(true);
  });

  it('isActive becomes false when all sources are restored', () => {
    mgr.markDegraded('s1');
    mgr.markDegraded('s2');
    mgr.markAvailable('s1');
    mgr.markAvailable('s2');
    expect(mgr.isActive()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // isAvailable
  // -------------------------------------------------------------------------

  it('isAvailable returns true for unregistered sources (open-world)', () => {
    expect(mgr.isAvailable('not-registered')).toBe(true);
  });

  it('isAvailable returns false for degraded sources', () => {
    mgr.markDegraded('s1');
    expect(mgr.isAvailable('s1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getAffectedSources / getAvailableSources
  // -------------------------------------------------------------------------

  it('getAffectedSources returns all non-available sources', () => {
    mgr.registerSource({ source_id: 'ok', source_type: 'api' });
    mgr.markDegraded('bad1');
    mgr.markUnavailable('bad2');

    const affected = mgr.getAffectedSources();
    const ids = affected.map(s => s.source_id);
    expect(ids).toContain('bad1');
    expect(ids).toContain('bad2');
    expect(ids).not.toContain('ok');
  });

  it('getAvailableSources returns only available sources (Req 13.4)', () => {
    mgr.registerSource({ source_id: 'ok', source_type: 'api' });
    mgr.markDegraded('bad');

    const available = mgr.getAvailableSources();
    expect(available.map(s => s.source_id)).toContain('ok');
    expect(available.map(s => s.source_id)).not.toContain('bad');
  });

  it('tracks multiple degraded sources', () => {
    ['s1', 's2', 's3'].forEach(id => mgr.markDegraded(id));
    expect(mgr.getAffectedSources()).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // getStatusReport (Req 13.6 — Dashboard display)
  // -------------------------------------------------------------------------

  it('getStatusReport shows degraded_mode_active false when all available', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    const report = mgr.getStatusReport();
    expect(report.degraded_mode_active).toBe(false);
    expect(report.affected_sources).toHaveLength(0);
    expect(report.available_source_count).toBe(1);
    expect(report.total_source_count).toBe(1);
  });

  it('getStatusReport shows degraded_mode_active true with affected list (Req 13.6)', () => {
    mgr.registerSource({ source_id: 'ok', source_type: 'api' });
    mgr.markDegraded('bad');

    const report = mgr.getStatusReport();
    expect(report.degraded_mode_active).toBe(true);
    expect(report.affected_sources.map(s => s.source_id)).toContain('bad');
    expect(report.available_source_count).toBe(1);
    expect(report.total_source_count).toBe(2);
  });

  it('getStatusReport counts match actual source states', () => {
    mgr.registerSource({ source_id: 'a', source_type: 'api' });
    mgr.registerSource({ source_id: 'b', source_type: 'api' });
    mgr.registerSource({ source_id: 'c', source_type: 'api' });
    mgr.markDegraded('b');
    mgr.markUnavailable('c');

    const report = mgr.getStatusReport();
    expect(report.total_source_count).toBe(3);
    expect(report.affected_sources).toHaveLength(2);
    expect(report.available_source_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  it('reset clears all degraded/unavailable states', () => {
    mgr.markDegraded('s1');
    mgr.markUnavailable('s2');
    mgr.reset();
    expect(mgr.isActive()).toBe(false);
    expect(mgr.isAvailable('s1')).toBe(true);
    expect(mgr.isAvailable('s2')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getConfig
  // -------------------------------------------------------------------------

  it('getConfig reflects current state', () => {
    mgr.registerSource({ source_id: 's1', source_type: 'api' });
    mgr.markDegraded('s1');
    const cfg = mgr.getConfig();
    expect(cfg.sources['s1'].status).toBe('degraded');
    expect(cfg.enabled).toBe(true);
    expect(cfg.allow_partial_results).toBe(true);
  });
});
