import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { artifactUrl, getGallery, getJob, submitJob, subscribe } from './api';
import { artifactKind, artifacts, cardId, cardMedia, cells, stageList, STAGES } from './model';
import type { Artifact, GalleryCard, JobIndex, StageEvent, SubmitPayload } from './types';
import './style.css';

const MAPS = ['San Francisco', 'Las Vegas', 'Boston', 'Singapore', 'Tel Aviv'];

function navigate(hash: string) { location.hash = hash; }
function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => { const update = () => setHash(location.hash || '#/'); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  const match = hash.match(/^#\/jobs\/([^/?]+)/);
  return match ? { view: 'job' as const, id: decodeURIComponent(match[1]) } : hash.startsWith('#/submit') ? { view: 'submit' as const } : { view: 'gallery' as const };
}

function Chip({ children, tone = '' }: { children: preact.ComponentChildren; tone?: string }) { return <span class={`chip ${tone}`}>{children}</span>; }
function Score({ label, value }: { label: string; value?: number }) { return <Chip>{label} <b>{value == null ? '—' : value.toFixed(1)}</b></Chip>; }
function ErrorBox({ error }: { error: unknown }) { return error ? <div class="error" role="alert">{error instanceof Error ? error.message : String(error)}</div> : null; }

function Header() {
  return <header><button class="brand" onClick={() => navigate('#/')}><span class="brand-mark">U</span><span><b>UniScenarios</b><small>pipeline showcase</small></span></button><nav><button onClick={() => navigate('#/')}>Gallery</button><button class="primary compact" onClick={() => navigate('#/submit')}>New job</button></nav></header>;
}

function Media({ source, label, loop = false }: { source?: string; label: string; loop?: boolean }) {
  if (!source) return <div class="media placeholder"><span>Render queued</span></div>;
  const url = artifactUrl(source);
  return artifactKind(source) === 'video'
    ? <video class="media" src={url} aria-label={label} muted={loop} autoPlay={loop} loop={loop} playsInline controls={!loop} />
    : <img class="media" src={url} alt={label} loading="lazy" />;
}

function Gallery() {
  const [cards, setCards] = useState<GalleryCard[]>([]); const [error, setError] = useState<unknown>(); const [loading, setLoading] = useState(true);
  useEffect(() => { getGallery().then(setCards).catch(setError).finally(() => setLoading(false)); }, []);
  return <main><section class="hero"><div><p class="eyebrow">EDGE-CASE CORPUS</p><h1>Scenes worth inspecting.</h1><p>Generated scenarios, gate evidence, and rendered behavior—from brief to verdict.</p></div><button class="primary" onClick={() => navigate('#/submit')}>Submit a scenario <span>→</span></button></section><ErrorBox error={error} />
    {loading ? <div class="empty">Loading gallery…</div> : !cards.length ? <div class="empty"><h2>No gallery entries yet</h2><p>Submit the first edge-case prompt to start the pipeline.</p></div> : <section class="gallery" aria-label="Scenario gallery">{cards.map((card) => {
      const id = cardId(card); const admitted = card.admitted ?? card.admittedCells ?? 0; const total = card.total ?? card.totalCells ?? 0;
      return <article class="gallery-card" key={id} onClick={() => navigate(`#/jobs/${encodeURIComponent(id)}`)} tabindex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`#/jobs/${encodeURIComponent(id)}`)}>
        <Media source={cardMedia(card)} label={card.brief ?? 'Scenario render'} loop />
        <div class="card-body"><div class="chip-row"><Chip tone="engine">{card.engine ?? 'auto'}</Chip><Chip tone={admitted ? 'pass' : 'fail'}>{admitted}/{total} admitted</Chip></div><h2>{card.headline ?? card.brief ?? 'Untitled scenario'}</h2>{card.headline && <p>{card.brief}</p>}<div class="chip-row"><Score label="Realism" value={card.realism} /><Score label="Dynamism" value={card.dynamism} /></div><div class="map-row">{card.maps?.map((map) => <Chip key={map}>{map}</Chip>)}</div></div>
      </article>;
    })}</section>}
  </main>;
}

function ArtifactView({ artifact, filmstrip = false }: { artifact: Artifact; filmstrip?: boolean }) {
  const kind = artifactKind(artifact); const url = artifactUrl(artifact); const label = artifact.name ?? artifact.path ?? artifact.url ?? 'artifact';
  if (kind === 'image') return <a class={filmstrip ? 'film-frame' : 'artifact-image'} href={url} target="_blank"><img src={url} alt={label} loading="lazy" /><span>{label.split('/').pop()}</span></a>;
  if (kind === 'video') return <div class="artifact-video"><video src={url} controls playsInline /><a href={url} download>Download video</a></div>;
  return <a class="download" href={url} download>↓ {label.split('/').pop()}</a>;
}

function StageCard({ event, index }: { event: StageEvent; index: number }) {
  const [number, name] = STAGES[index]; const stageArtifacts = artifacts(event); const isFilmstrip = number === '20' && stageArtifacts.filter((item) => artifactKind(item) === 'image').length > 1;
  return <details class={`stage ${event.status}`} open={event.status === 'running'}><summary><span class="stage-dot" /><span class="stage-number">{number}</span><b>{name}</b><span class="stage-status">{event.status}</span>{event.elapsedMs != null && <span class="elapsed">{(event.elapsedMs / 1000).toFixed(1)}s</span>}<span class="chevron">⌄</span></summary><div class="stage-content">
    {stageArtifacts.length > 0 && <div class={isFilmstrip ? 'filmstrip' : 'artifacts'}>{stageArtifacts.map((item, i) => <ArtifactView key={`${item.path ?? item.url}-${i}`} artifact={item} filmstrip={isFilmstrip} />)}</div>}
    <h4>Raw stage JSON</h4><pre>{JSON.stringify(event, null, 2)}</pre>
  </div></details>;
}

function verdict(value?: boolean) { return value == null ? '—' : value ? 'PASS' : 'FAIL'; }
function CellGrid({ job }: { job: JobIndex | null }) {
  const rows = cells(job); if (!rows.length) return <div class="empty small">Cells appear after simulation.</div>;
  return <div class="cell-grid">{rows.map((cell) => { const gate = typeof cell.gate === 'boolean' ? cell.gate : cell.gate?.pass ?? cell.gate?.admitted; const judge = cell.judge; return <details class="cell" key={cell.cellId ?? cell.id}><summary><div><small>{cell.map ?? 'map'}</small><b>{cell.cellId ?? cell.id}</b></div><Chip tone={gate === true ? 'pass' : gate === false ? 'fail' : ''}>{verdict(gate)}</Chip></summary><div class="cell-body"><div class="chip-row"><Score label="Realism" value={judge?.realism} /><Score label="Dynamism" value={judge?.dynamism} />{judge?.plausible != null && <Chip tone={judge.plausible ? 'pass' : 'fail'}>{judge.plausible ? 'plausible' : 'implausible'}</Chip>}</div>{typeof cell.gate === 'object' && cell.gate.firstFailure && <p class="failure">First failure: {cell.gate.firstFailure}</p>}<div class="artifacts">{artifacts(cell).map((item, i) => <ArtifactView key={i} artifact={item} />)}</div><pre>{JSON.stringify(cell, null, 2)}</pre></div></details>; })}</div>;
}

function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<JobIndex | null>(null); const [live, setLive] = useState<Record<string, StageEvent>>({}); const [connected, setConnected] = useState(false); const [error, setError] = useState<unknown>();
  const refresh = () => getJob(id).then(setJob).catch(setError);
  useEffect(() => { refresh(); const stop = subscribe(id, (event) => { const key = event.stage.match(/\d{2}/)?.[0] ?? event.stage; setLive((old) => ({ ...old, [key]: event })); if (event.status === 'complete' || event.status === 'failed') refresh(); }, setConnected); return stop; }, [id]);
  const stages = useMemo(() => stageList(job, live), [job, live]);
  return <main><button class="back" onClick={() => navigate('#/')}>← Gallery</button><section class="job-heading"><div><div class="chip-row"><Chip tone="engine">{job?.engine ?? (job?.options?.engine as string) ?? 'routing'}</Chip><Chip tone={connected ? 'live' : ''}><span class="live-dot" />{connected ? 'live' : 'reconnecting'}</Chip><Chip>{job?.status ?? 'in progress'}</Chip></div><h1>{job?.brief ?? (job?.options?.brief as string) ?? `Job ${id}`}</h1><p class="mono">{id}</p></div><button onClick={refresh}>Refresh index</button></section><ErrorBox error={error} />
    <section><div class="section-title"><div><p class="eyebrow">PIPELINE</p><h2>Stage timeline</h2></div><p>Expand any stage to inspect its exact output and artifacts.</p></div><div class="timeline">{stages.map((event, i) => <StageCard event={event} index={i} key={STAGES[i][0]} />)}</div></section>
    <section><div class="section-title"><div><p class="eyebrow">EVIDENCE</p><h2>Scenario cells</h2></div><p>Gate and footage-judge verdicts by map, site, and draw.</p></div><CellGrid job={job} /></section>
  </main>;
}

const initial: SubmitPayload = { brief: '', engine: 'auto', nScenarios: 3, maps: [...MAPS], maxSitesPerMap: 3, ambient: 'light', seed: 42, render3d: true, topK: 3, judge: true };
function Submit() {
  const [form, setForm] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const update = <K extends keyof SubmitPayload>(key: K, value: SubmitPayload[K]) => setForm((old) => ({ ...old, [key]: value }));
  const send = async (e: Event) => { e.preventDefault(); setBusy(true); setError(undefined); try { navigate(`#/jobs/${encodeURIComponent(await submitJob(form))}`); } catch (reason) { setError(reason); setBusy(false); } };
  return <main class="submit-page"><button class="back" onClick={() => navigate('#/')}>← Gallery</button><section class="submit-intro"><p class="eyebrow">NEW PIPELINE JOB</p><h1>Author an edge case.</h1><p>Compiler jobs usually produce first video in 2–3 minutes. Vista2 visual authoring may take 5–15 minutes; its action filmstrip streams into the job view.</p></section><ErrorBox error={error} /><form onSubmit={send}>
    <label class="wide"><span>Scenario brief</span><textarea required minlength={12} value={form.brief} onInput={(e) => update('brief', e.currentTarget.value)} placeholder="A delivery van blocks the bike lane just before an intersection as a cyclist approaches…" /></label>
    <div class="form-grid"><label><span>Engine</span><select value={form.engine} onChange={(e) => update('engine', e.currentTarget.value as SubmitPayload['engine'])}><option value="auto">Auto route</option><option value="compiler">Compiler</option><option value="vista2">Vista2 visual agent</option></select></label>
      <label><span>Scenarios / site</span><input type="number" min="1" max="20" value={form.nScenarios} onInput={(e) => update('nScenarios', e.currentTarget.valueAsNumber)} /></label>
      <label><span>Max sites / map</span><input type="number" min="1" max="20" value={form.maxSitesPerMap} onInput={(e) => update('maxSitesPerMap', e.currentTarget.valueAsNumber)} /></label>
      <label><span>Ambient traffic</span><select value={form.ambient} onChange={(e) => update('ambient', e.currentTarget.value as SubmitPayload['ambient'])}>{['off', 'light', 'moderate', 'city', 'heavy'].map((v) => <option value={v}>{v}</option>)}</select></label>
      <label><span>Seed</span><input type="number" value={form.seed} onInput={(e) => update('seed', e.currentTarget.valueAsNumber)} /></label>
      <fieldset class="wide"><legend>Maps</legend><div class="map-options">{MAPS.map((map) => <label class="check"><input type="checkbox" checked={form.maps.includes(map)} onChange={(e) => update('maps', e.currentTarget.checked ? [...form.maps, map] : form.maps.filter((value) => value !== map))} /><span>{map}</span></label>)}</div></fieldset>
      <label class="toggle"><input type="checkbox" checked={form.render3d} onChange={(e) => update('render3d', e.currentTarget.checked)} /><span><b>3D rendering</b><small>Render highest-ranked passing cells</small></span></label>
      <label><span>3D top K</span><input type="number" min="1" max="10" disabled={!form.render3d} value={form.topK} onInput={(e) => update('topK', e.currentTarget.valueAsNumber)} /></label>
      <label class="toggle"><input type="checkbox" checked={form.judge} onChange={(e) => update('judge', e.currentTarget.checked)} /><span><b>Footage judge</b><small>Score realism and dynamism</small></span></label>
    </div><div class="submit-actions"><span>{form.maps.length} maps · up to {form.maps.length * form.maxSitesPerMap * form.nScenarios} cells</span><button class="primary" disabled={busy || !form.maps.length}>{busy ? 'Submitting…' : 'Start pipeline →'}</button></div>
  </form></main>;
}

function App() { const route = useRoute(); return <><Header />{route.view === 'job' ? <JobDetail id={route.id} /> : route.view === 'submit' ? <Submit /> : <Gallery />}<footer>UniScenarios · intermediate outputs preserved stage by stage</footer></>; }

render(<App />, document.getElementById('app')!);
