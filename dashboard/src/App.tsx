import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Circle, Database, ExternalLink, Layers, LoaderCircle, LogOut, Plus, Search, ShieldCheck, Sparkles, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { ApiError, fetchDashboardData, fetchRecords, signIn, signOut, submitPrompt, triggerExport, retryExecution } from './api';
import type { DashboardView, ExecutionResult, RecordInspection } from './types';
import './App.css';
import { CollectionSummary, EvidenceDetails } from './components/CollectionSummary';

const examples = [
  { title: 'Find business leads', label: 'Discover & verify', text: 'Find 5 TV retailers in Pune, India. Collect business name, address and publicly listed business phone number, with source evidence. Return CSV.' },
  { title: 'Turn an API into a dataset', label: 'Connect a source', text: 'From https://jsonplaceholder.typicode.com/posts collect 10 posts with id, title and body. Return JSON.' },
  { title: 'Find exactly what matters', label: 'Filter & organize', text: 'From https://jsonplaceholder.typicode.com/todos find tasks where userId equals 1, with id and title. Return CSV.' },
];
const formatDate = (date: string) => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const duration = (ms?: number) => ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
function Status({ value }: { value: string }) { return <span className={`status ${value}`}><span />{value}</span>; }
function App() {
  const [data, setData] = useState<DashboardView | null>(null);
  const [auth, setAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [view, setView] = useState<'workspace' | 'history'>('workspace');
  const [selected, setSelected] = useState<string | null>(null);
  const [records, setRecords] = useState<RecordInspection | null>(null);
  const [offset, setOffset] = useState(0);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const refresh = useCallback(async () => {
    try { const result = await fetchDashboardData(); setData(result); setAuth(false); setError(''); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { setAuth(true); setData(null); } else setError(e instanceof Error ? e.message : 'Could not reach the platform'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => { if (!document.hidden) void refresh(); }, 3000); return () => clearInterval(id); }, [refresh]);
  const active = data?.execution_results.find(e => e.execution_id === selected);
  useEffect(() => {
    if (!selected || active?.status !== 'completed') { setRecords(null); return; }
    let cancelled = false; setRecordLoading(true);
    fetchRecords(selected, offset).then(r => { if (!cancelled) setRecords(r); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load records'); }).finally(() => { if (!cancelled) setRecordLoading(false); });
    return () => { cancelled = true; };
  }, [selected, offset, active?.status]);
  useEffect(() => { if (record) closeRef.current?.focus(); }, [record]);
  const newRun = () => { setSelected(null); setView('workspace'); setSidebar(false); setTimeout(() => textarea.current?.focus(), 0); };
  const selectRun = (id: string) => { setSelected(id); setOffset(0); setRecords(null); setExportError(''); setView('workspace'); setSidebar(false); };
  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError('');
    try { const job = await submitPrompt(prompt); setPrompt(''); selectRun(job.execution_id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start run'); }
    finally { setBusy(false); }
  };
  const download = async (format: 'csv' | 'json') => {
    if (!selected || exporting) return;
    setExporting(true); setExportError('');
    try {
      const result = await triggerExport(selected, format);
      const response = await fetch(result.download_url);
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? 'Download failed'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `dataset-${selected}.${format}`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  };
  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" /><p>Connecting to your workspace…</p></div>;
  if (auth) return <div className="login-shell"><form className="login-card" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void signIn(token).then(() => { setToken(''); return refresh(); }).catch(e => setError(e instanceof Error ? e.message : 'Sign-in failed')).finally(() => setBusy(false)); }}><span className="brand-mark"><Layers size={24} /></span><span className="eyebrow">DATA INTELLIGENCE WORKSPACE</span><h1>Good work starts<br />with good data.</h1><p>Sign in to turn your questions into traceable datasets.</p><label htmlFor="access-key">Workspace access key</label><input id="access-key" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="current-password" required placeholder="Enter your access key" />{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : 'Open workspace'}<ArrowRight size={16} /></button><small>Your administrator provides this workspace’s access key.</small></form><div className="login-art" aria-hidden="true"><div className="orbital"><div /><div /><div /><Sparkles size={48} /></div><p>From a question.<br /><em>To something you can trust.</em></p><span>PLAN · VERIFY · RUN</span></div></div>;
  const jobs = data?.execution_results ?? [];
  const completed = jobs.filter(j => j.status === 'completed');
  const totalRecords = completed.reduce((sum, j) => sum + j.records_processed, 0);
  const filtered = jobs.filter(j => `${j.prompt ?? ''} ${j.execution_id}`.toLowerCase().includes(search.toLowerCase()));
  const columns = records?.records[0] ? Object.keys(records.records[0]).filter(k => k !== '_provenance') : [];
  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); newRun(); }}><span className="brand-mark"><Layers size={20} /></span>Forma<span className="brand-sub"> / intelligence</span></a>
      <button className="new-button" onClick={newRun}><Plus size={17} /> New dataset <span>↗</span></button>
      <nav aria-label="Main navigation"><button className={view === 'workspace' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('workspace'); setSidebar(false); }}><Sparkles size={17} /> Workspace</button><button className={view === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('history'); setSidebar(false); }}><Activity size={17} /> Run history <span className="nav-count">{jobs.length}</span></button></nav>
      <div className="sidebar-label">RECENT DATASETS</div><div className="recent-list">{jobs.slice(0, 7).map(job => <button key={job.execution_id} className={selected === job.execution_id ? 'recent selected' : 'recent'} onClick={() => selectRun(job.execution_id)}><span className={`mini-dot ${job.status}`} /><span>{job.prompt ?? job.execution_id}</span></button>)}{!jobs.length && <p className="sidebar-empty">Your datasets will appear here.<br />Start with a question.</p>}</div>
      <div className="sidebar-bottom"><div className="workspace-note"><ShieldCheck size={18} /><div>Evidence, included.<p>Every record. Every source.</p></div></div><div className="account"><span className="avatar">W</span><div>My workspace<small>Private workspace</small></div><button className="icon-button" aria-label="Sign out" onClick={() => { void signOut().then(() => { setSelected(null); return refresh(); }); }}><LogOut size={16} /></button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><span>Workspace</span><ChevronRight size={13} /><strong>{view === 'history' ? 'Run history' : selected ? 'Dataset details' : 'Overview'}</strong></div><span className={`connection ${error ? 'offline' : ''}`}><span />{error ? 'Connection needs attention' : 'Connected to platform'}</span></header>
    <main>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
      {view === 'workspace' && !selected && <>
        <section className="welcome"><div className="eyebrow"><span /> YOUR NEXT DISCOVERY STARTS HERE</div><h1>A little curiosity.<br /><em>A lot of clarity.</em></h1><p>Turn a question into a dataset you can trust.<br className="mobile-break" /> Plan, verify, and collect — in one workspace.</p></section>
        <section className="composer-section"><form className="composer" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="prompt" className="sr-only">Describe your dataset</label><textarea ref={textarea} id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={10000} placeholder="What would you like to discover?" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} /><div className="composer-footer"><span><span className="model-dot" />{data?.model ?? 'Gemini 3'}<span className="composer-divider" />Verified workflows</span><button className="submit-button" type="submit" disabled={!prompt.trim() || busy} aria-label="Create dataset">{busy ? <LoaderCircle size={20} className="spin" /> : <ArrowUp size={20} />}</button></div></form><div className="composer-hint"><ShieldCheck size={13} />Include a public HTTPS JSON API URL and the fields you need.<span>⌘ / Ctrl + Enter</span></div></section>
        <section className="examples" aria-label="Example prompts">{examples.map((example, i) => <button key={example.title} className="example-card" onClick={() => { setPrompt(example.text); textarea.current?.focus(); }}><span className="example-icon">{i === 0 ? <Search size={18} /> : i === 1 ? <Database size={18} /> : <Layers size={18} />}</span><small>{example.label}</small><strong>{example.title}</strong><ArrowRight className="example-arrow" size={15} /></button>)}</section>
        <section className="activity-section"><div className="section-heading"><div><span className="eyebrow">YOUR WORK, AT A GLANCE</span><h2>Workspace activity</h2></div><button className="text-button" onClick={() => setView('history')}>View all runs <ArrowRight size={15} /></button></div><div className="metrics"><div><span>Datasets created</span><strong>{completed.length}<Database size={19} /></strong><small>Completed and verified</small></div><div><span>Records collected</span><strong>{totalRecords.toLocaleString()}<Layers size={19} /></strong><small>With source provenance</small></div><div><span>Active runs</span><strong>{jobs.filter(j => ['running','pending'].includes(j.status)).length}<Activity size={19} /></strong><small>Planning, verifying, or collecting</small></div></div>{jobs.length ? <RunTable jobs={jobs.slice(0, 4)} onSelect={selectRun} /> : <div className="empty-state"><div className="empty-icon"><Database size={23} /></div><h3>A clean slate. Endless possibilities.</h3><p>Your first dataset is one good question away.</p><button className="text-button" onClick={() => textarea.current?.focus()}>Create your first dataset <ArrowRight size={15} /></button></div>}</section>
      </>}
      {view === 'history' && <section className="history"><div className="eyebrow">THE FULL PICTURE</div><h1>Run history</h1><p className="muted">Every question, every result, and everything in between.</p><div className="search-field"><Search size={17} /><input aria-label="Search runs" placeholder="Search your runs…" value={search} onChange={e => setSearch(e.target.value)} /></div>{filtered.length ? <RunTable jobs={filtered} onSelect={selectRun} /> : <div className="empty-state"><Search size={28} /><h3>No runs found</h3><p>{search ? 'Try a different search.' : 'Create a dataset to start your history.'}</p></div>}</section>}
      {view === 'workspace' && selected && <section className="details"><button className="text-button" onClick={newRun}><ChevronLeft size={15} /> Back to workspace</button>{active ? <><div className="detail-title"><div><span className="eyebrow">DATASET WORKSPACE</span><h1>{active.prompt ?? 'Dataset details'}</h1><p className="muted">Started {formatDate(active.started_at)} · {duration(active.duration_ms)}</p></div><Status value={active.status} /></div><div className="pipeline"><div className="section-heading"><h2>From question to confidence</h2><span className="muted">Verification pipeline</span></div><div className="stages">{active.verification_stages.map((stage, i) => <div key={stage.stage_name} className={`stage ${stage.status}`}><span className="stage-icon">{stage.status === 'success' ? <Check size={16} /> : stage.status === 'running' ? <LoaderCircle size={16} className="spin" /> : stage.status === 'failed' ? <X size={16} /> : <Circle size={13} />}</span><span>{stage.stage_name}<small>{stage.status}</small></span>{i !== active.verification_stages.length - 1 && <span className="stage-line" />}</div>)}</div></div><CollectionSummary collection={active.collection} busy={busy} onRetry={['failed', 'completed'].includes(active.status) && active.collection?.coverage === 'partial' ? () => { setBusy(true); void retryExecution(active.execution_id).then(job => { selectRun(job.execution_id); return refresh(); }).catch(e => setError(e instanceof Error ? e.message : 'Could not resume collection')).finally(() => setBusy(false)); } : undefined} />{active.error && <div className="error-banner" role="alert">{active.error}</div>}{active.status === 'completed' ? <section className="dataset"><div className="section-heading"><div><h2>Your dataset</h2><p className="muted">{active.records_processed.toLocaleString()} records · Inspect a record to view its source</p></div><div className="export-actions"><button disabled={exporting} onClick={() => void download('csv')}><ArrowDownToLine size={15} /> CSV</button><button disabled={exporting} onClick={() => void download('json')}><ArrowDownToLine size={15} /> JSON</button></div></div>{exportError && <p className="error" role="alert">{exportError}</p>}{recordLoading ? <p role="status">Loading records…</p> : <div className="table-scroll"><table><thead><tr><th>#</th>{columns.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}<th>Evidence</th></tr></thead><tbody>{records?.records.map((r, i) => <tr key={i}><td>{offset + i + 1}</td>{columns.map(c => <td key={c}><span className="cell-value">{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '—')}</span></td>)}<td><button className="text-button" onClick={() => setRecord(r)} aria-label={`Inspect record ${offset + i + 1}`}><ShieldCheck size={15} /> Inspect</button></td></tr>)}</tbody></table></div>}<div className="pagination"><span>{offset + 1}–{Math.min(offset + 25, active.records_processed)} of {active.records_processed}</span><button aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={offset + 25 >= active.records_processed} onClick={() => setOffset(offset + 25)}><ChevronRight size={17} /></button></div></section> : active.status !== 'failed' && <div className="empty-state"><LoaderCircle className="spin" size={25} /><h3>Your dataset is taking shape.</h3><p>Progress updates automatically. You can leave this page and return later.</p></div>}<div className="run-reference">RUN {active.execution_id}{active.workflow_id && <> · WORKFLOW {active.workflow_id}</>}</div></> : <p role="status">Loading execution…</p>}</section>}
      <footer><span><Layers size={13} /> Forma</span><span>Source-linked. Schema-checked.</span><span>Plan <span>→</span> Verify <span>→</span> Run</span></footer>
    </main></div>
    {record && <div className="modal-overlay" onClick={() => setRecord(null)}><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setRecord(null); if (e.key === 'Tab') { const focusable = e.currentTarget.querySelectorAll<HTMLElement>('button,a[href]'); const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}><div className="section-heading"><h2 id="record-title">Behind the record</h2><button ref={closeRef} className="icon-button" aria-label="Close record" onClick={() => setRecord(null)}><X size={20} /></button></div><p className="muted">Inspect the data and trace it back to its source.</p><dl>{Object.entries(record).filter(([k]) => k !== '_provenance').map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}</dl><div className="provenance"><ShieldCheck size={20} /><h3>Source provenance</h3>{Object.entries((record._provenance ?? {}) as Record<string, unknown>).filter(([key]) => !['field_evidence', 'qualification_evidence', 'extraction_confidence', 'confidence_method'].includes(key)).map(([k,v]) => <div key={k}><span>{k.replaceAll('_', ' ')}</span>{k === 'source_url' && /^https:\/\//.test(String(v)) ? <a href={String(v)} target="_blank" rel="noopener noreferrer">View original source <ExternalLink size={13} /></a> : <code>{String(v)}</code>}</div>)}</div><EvidenceDetails provenance={(record._provenance ?? {}) as Record<string, unknown>} /></section></div>}
  </div>;
}
function RunTable({ jobs, onSelect }: { jobs: ExecutionResult[]; onSelect: (id: string) => void }) { return <div className="table-scroll run-table"><table><thead><tr><th>Dataset</th><th>Status</th><th>Records</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{jobs.map(job => <tr key={job.execution_id}><td><button className="run-name" onClick={() => onSelect(job.execution_id)}><Database size={16} /><span>{job.prompt ?? job.execution_id}</span></button></td><td><Status value={job.status} /></td><td>{job.status === 'completed' ? job.records_processed.toLocaleString() : '—'}</td><td>{formatDate(job.started_at)}</td><td><button className="icon-button" aria-label={`Open run ${job.execution_id}`} onClick={() => onSelect(job.execution_id)}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div>; }
export default App;
