import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { artifactUrl, campaignCaseProgress, CAMPAIGN_ID, getCampaign, getGallery, getJob, submitJob, subscribe } from './api';
import { artifactKind, artifacts, cardId, cardMedia, cells, scopeStageArtifacts, stageList, STAGES, threeDVideos } from './model';
import type {
  Artifact, CampaignCase, CampaignCaseState, CampaignReport, CampaignValidityContract, CampaignVideo,
  GalleryCard, JobIndex, StageEvent, SubmitPayload,
} from './types';
import './style.css';

const MAPS = [
  ['yale-street', 'Yale Street'],
  ['belmont-research-center', 'Belmont Research Center'],
  ['el-camino-road', 'El Camino Road'],
  ['easterbrook-discovery-school', 'Easterbrook Discovery School'],
  ['richmond-field-station', 'Richmond Field Station'],
] as const;
const mapLabel = (id: string) => MAPS.find(([mapId]) => mapId === id)?.[1] ?? id;

function navigate(hash: string) { location.hash = hash; }
function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => { const update = () => setHash(location.hash || '#/'); addEventListener('hashchange', update); return () => removeEventListener('hashchange', update); }, []);
  const job = hash.match(/^#\/jobs\/([^/?]+)/);
  const campaign = hash.match(/^#\/campaigns\/([^/?]+)/);
  if (job) return { view: 'job' as const, id: decodeURIComponent(job[1]) };
  if (campaign) return { view: 'campaign' as const, id: decodeURIComponent(campaign[1]) };
  return hash.startsWith('#/submit') ? { view: 'submit' as const } : { view: 'gallery' as const };
}

function Chip({ children, tone = '' }: { children: preact.ComponentChildren; tone?: string }) { return <span class={`chip ${tone}`}>{children}</span>; }
function Score({ label, value }: { label: string; value?: number }) { return <Chip>{label} <b>{value == null ? '—' : value.toFixed(1)}</b></Chip>; }
function ErrorBox({ error }: { error: unknown }) { return error ? <div class="error" role="alert">{error instanceof Error ? error.message : String(error)}</div> : null; }

function Header() {
  return <header><button class="brand" onClick={() => navigate('#/')}><span class="brand-mark">U</span><span><b>UniScenarios</b><small>pipeline showcase</small></span></button><nav><button onClick={() => navigate('#/')}>Gallery</button><button onClick={() => navigate(`#/campaigns/${CAMPAIGN_ID}`)}>Campaign</button><button class="primary compact" onClick={() => navigate('#/submit')}>New job</button></nav></header>;
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
      const id = cardId(card); const admitted = card.admittedCells ?? (typeof card.admitted === 'number' ? card.admitted : 0); const total = card.totalCells ?? card.total ?? 0;
      return <article class="gallery-card" key={id} onClick={() => navigate(`#/jobs/${encodeURIComponent(id)}`)} tabindex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`#/jobs/${encodeURIComponent(id)}`)}>
        <Media source={cardMedia(card)} label={card.brief ?? 'Scenario render'} loop />
        <div class="card-body"><div class="chip-row"><Chip tone="engine">{card.engine ?? 'auto'}</Chip><Chip tone={admitted ? 'pass' : 'fail'}>{admitted}/{total} admitted</Chip></div><h2>{card.headline ?? card.brief ?? 'Untitled scenario'}</h2>{card.headline && <p>{card.brief}</p>}<div class="chip-row"><Score label="Realism" value={card.realism} /><Score label="Dynamism" value={card.dynamism} /></div><div class="map-row">{card.maps?.map((map) => <Chip key={map}>{mapLabel(map)}</Chip>)}</div></div>
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
  return <div class="cell-grid">{rows.map((cell) => { const gate = typeof cell.gate === 'boolean' ? cell.gate : cell.gate?.pass ?? cell.gate?.admitted; const judge = cell.judge; return <details class="cell" key={cell.cellId ?? cell.id}><summary><div><small>{cell.map ? mapLabel(cell.map) : 'map'}</small><b>{cell.cellId ?? cell.id}</b></div><Chip tone={gate === true ? 'pass' : gate === false ? 'fail' : ''}>{verdict(gate)}</Chip></summary><div class="cell-body"><div class="chip-row"><Score label="Realism" value={judge?.realism} /><Score label="Dynamism" value={judge?.dynamism} />{judge?.plausible != null && <Chip tone={judge.plausible ? 'pass' : 'fail'}>{judge.plausible ? 'plausible' : 'implausible'}</Chip>}</div>{judge && (judge.semanticAccepted != null || judge.presentationAccepted != null) && <div class="chip-row"><Chip tone={judge.semanticAccepted ? 'pass' : 'fail'}>scenario {judge.semanticAccepted ? 'accepted' : 'rejected'}</Chip><Chip tone={judge.presentationAccepted ? 'pass' : 'fail'}>presentation {judge.presentationAccepted ? 'accepted' : 'rejected'}</Chip>{judge.defectCodes?.map((code) => <Chip tone="fail" key={code}>{code}</Chip>)}</div>}{judge?.unsupportedReason && <p class="failure">Unsupported: {judge.unsupportedReason}</p>}{typeof cell.gate === 'object' && cell.gate.firstFailure && <p class="failure">First failure: {cell.gate.firstFailure}</p>}<div class="artifacts">{artifacts(cell).map((item, i) => <ArtifactView key={i} artifact={item} />)}</div><pre>{JSON.stringify(cell, null, 2)}</pre></div></details>; })}</div>;
}

function ThreeDGallery({ job, status }: { job: JobIndex | null; status: string }) {
  const videos = threeDVideos(job);
  if (!videos.length) {
    const message = status === 'running'
      ? 'Candidate renders stay hidden until simulation, rendering, and the split scenario/presentation acceptance review all complete.'
      : status === 'complete'
        ? 'No 3D candidate cleared both verdicts: the render must show the requested scenario and be usable footage. Inspect Pipeline details for the attributed defect codes.'
        : 'Accepted 3D videos will appear after gate-passing scenarios finish rendering and review.';
    return <div class="empty video-empty"><div class="render-pulse" /><h2>Accepted 3D videos</h2><p>{message}</p></div>;
  }
  return <div class="job-video-gallery">{videos.map(({ cell, artifact }) => {
    const id = cell.cellId ?? cell.id ?? 'scenario';
    const source = artifact.path ?? artifact.url ?? '';
    return <article class="job-video-card" key={id}>
      <video src={artifactUrl(source)} aria-label={`Accepted 3D rollout for ${id}`} muted autoPlay loop playsInline controls preload="metadata" />
      <div class="job-video-meta"><div><small>{cell.map ? mapLabel(cell.map) : '3D scenario'}</small><h2>{id}</h2></div><div class="chip-row">
        <Chip tone="pass">scenario + presentation accepted</Chip>
        <Score label="Realism" value={cell.judge?.realism} /><Score label="Dynamism" value={cell.judge?.dynamism} />
      </div></div>
    </article>;
  })}</div>;
}

function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<JobIndex | null>(null);
  const [live, setLive] = useState<Record<string, StageEvent>>({});
  const [connected, setConnected] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<unknown>();
  const refresh = () => getJob(id).then((value) => { setJob(value); setError(undefined); }).catch(setError);
  useEffect(() => {
    refresh();
    const stop = subscribe(id, (incoming) => {
      const event = scopeStageArtifacts(id, incoming);
      const key = event.stage.match(/\d{2}/)?.[0] ?? event.stage;
      setLive((old) => ({ ...old, [key]: event }));
      if (event.status === 'complete' || event.status === 'failed') refresh();
    }, setConnected);
    return stop;
  }, [id]);
  const stages = useMemo(() => stageList(job, live), [job, live]);
  const completed = stages.filter((stage) => stage.status === 'complete').length;
  return <main><button class="back" onClick={() => navigate('#/')}>← Gallery</button>
    <section class="job-heading"><div><div class="chip-row"><Chip tone="engine">{job?.engine ?? (job?.options?.engine as string) ?? 'routing'}</Chip><Chip>{(job?.options?.methodology as string) ?? 'custom'}</Chip><Chip tone={connected ? 'live' : ''}><span class="live-dot" />{connected ? 'live' : 'reconnecting'}</Chip><Chip>{job?.status ?? 'in progress'}</Chip></div><h1>{job?.brief ?? (job?.options?.brief as string) ?? `Job ${id}`}</h1><p class="mono">{id}</p></div><button onClick={refresh}>Refresh</button></section>
    <ErrorBox error={error} />
    <section class="video-gallery-section"><div class="section-title"><div><p class="eyebrow">3D OUTPUT</p><h2>Your scenario videos</h2></div><p>{completed}/{STAGES.length} pipeline stages complete. Videos appear here automatically.</p></div><ThreeDGallery job={job} status={stages[9]?.status ?? 'pending'} /></section>
    <button class="details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}>{showDetails ? 'Hide pipeline details' : 'Show pipeline details'} <span>{showDetails ? '↑' : '↓'}</span></button>
    {showDetails && <div class="pipeline-details">
      <section><div class="section-title"><div><p class="eyebrow">PIPELINE DETAILS</p><h2>Intermediate stages</h2></div><p>Optional diagnostics: inspect exact outputs and artifacts from every stage.</p></div><div class="timeline">{stages.map((event, i) => <StageCard event={event} index={i} key={STAGES[i][0]} />)}</div></section>
      <section><div class="section-title"><div><p class="eyebrow">CELL DETAILS</p><h2>Gate and judge evidence</h2></div><p>Optional per-location gate and footage-judge verdicts.</p></div><CellGrid job={job} /></section>
    </div>}
  </main>;
}

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plainCount = new Intl.NumberFormat('en');
function duration(seconds?: number) {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds - hours * 3600) / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}
function ago(iso?: string) {
  const elapsed = iso ? Date.now() - Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(elapsed)) return '';
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div class="meter" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}><i style={{ width: `${percent.toFixed(2)}%` }} /></div>;
}
function Stat({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: preact.ComponentChildren }) {
  return <div class="stat"><small>{label}</small><b>{value}</b>{children}{hint && <span>{hint}</span>}</div>;
}
function Pips({ value, max }: { value: number; max: number }) {
  return <span class="pips" role="img" aria-label={`${value} of ${max} accepted videos`}>{Array.from({ length: max }, (_, index) => <span key={index} class={index < value ? 'pip on' : 'pip'} />)}</span>;
}

function AcceptedVideo({ video, caseTitle, heading }: { video: CampaignVideo; caseTitle: string; heading: string }) {
  const jobId = video.jobId;
  return <article class="job-video-card campaign-video-card">
    <video src={artifactUrl(video.url)} aria-label={`Accepted 3D video for ${caseTitle}`} controls playsInline preload="metadata" muted loop />
    <div class="job-video-meta">
      <div><small>{video.mapId ? mapLabel(video.mapId) : 'accepted 3D render'}</small><h2 title={heading}>{heading}</h2></div>
      <div class="chip-row"><Chip tone="pass">strictly accepted</Chip>{video.realism != null && <Score label="Realism" value={video.realism} />}{video.dynamism != null && <Score label="Dynamism" value={video.dynamism} />}</div>
    </div>
    <div class="campaign-video-foot">
      <span title={`sha256 ${video.sha256}${video.acceptedAt ? ` · accepted ${new Date(video.acceptedAt).toLocaleString()}` : ''}`}>{video.acceptedAt ? `accepted ${ago(video.acceptedAt)} · ` : ''}sha {video.sha256.slice(0, 10)}</span>
      {jobId && <button class="ghost-link" onClick={() => navigate(`#/jobs/${encodeURIComponent(jobId)}`)}>Inspect job evidence →</button>}
    </div>
  </article>;
}

const CASE_STATE: Record<CampaignCaseState, [label: string, tone: string]> = {
  complete: ['complete', 'pass'], running: ['rendering', 'live'], blocked: ['needs retry', 'fail'], idle: ['pending', ''],
};
const ATTEMPT_TONE: Record<string, string> = { complete: 'pass', failed: 'fail', running: 'live', queued: '' };

function CampaignCaseRow({ item, target }: { item: CampaignCase; target: number }) {
  const progress = campaignCaseProgress(item, target);
  const [label, tone] = CASE_STATE[progress.state];
  const stateLabel = progress.state === 'idle' && progress.attempts > 0 ? 'awaiting attempt' : label;
  const [open, setOpen] = useState(false);
  return <details class={`campaign-case ${progress.state}`} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span class="case-index">{String(item.index + 1).padStart(2, '0')}</span>
      <b>{item.title}</b>
      <Pips value={progress.accepted} max={target} />
      <span class="case-count">{progress.accepted}/{target}</span>
      <Chip tone={tone}>{stateLabel}</Chip>
      <span class="chevron">⌄</span>
    </summary>
    {open && <div class="case-body">
      {progress.accepted > 0
        ? <div class="job-video-gallery campaign-videos">{item.validVideos.map((video) => <AcceptedVideo key={video.sha256} video={video} caseTitle={item.title} heading={video.cellId ?? `sha ${video.sha256.slice(0, 12)}`} />)}</div>
        : <p class="case-note">No attempt has cleared strict acceptance for this case yet. Attempts below are status only—rejected or failed renders are never shown as results.</p>}
      <div class="attempt-head"><h4>Attempts</h4><span>{progress.attempts} submitted · {progress.active} in flight · {progress.failed} failed</span></div>
      {progress.attempts === 0
        ? <p class="case-note">Waiting for the campaign runner to submit the first attempt.</p>
        : <ol class="attempt-list">{item.attempts.map((attempt) => <li key={attempt.number} class={attempt.status}>
          <span class="attempt-number">#{attempt.number}</span>
          <Chip tone={ATTEMPT_TONE[attempt.status] ?? ''}>{attempt.status}</Chip>
          <button class="ghost-link mono" onClick={() => navigate(`#/jobs/${encodeURIComponent(attempt.jobId)}`)}>{attempt.jobId}</button>
          <span class="attempt-meta">{attempt.status === 'running' || attempt.status === 'queued' ? 'in flight' : duration(attempt.metrics?.wallS)}</span>
          {attempt.error && <span class="failure">{attempt.error}</span>}
        </li>)}</ol>}
    </div>}
  </details>;
}

const CONTRACT_LABELS: Record<string, string> = {
  semanticAcceptedRequired: 'scenario fidelity accepted',
  presentationAcceptedRequired: 'presentation accepted',
  frozenGateRequired: 'frozen C1–C6 gate',
  briefAware3dReviewRequired: 'brief-aware 3D review',
  currentReviewContractRequired: 'current review contract',
  uniqueVideoSha256Required: 'unique MP4 SHA-256',
};
const CASE_FILTERS = [['all', 'All cases'], ['open', 'In progress'], ['complete', 'Complete']] as const;
type CaseFilter = (typeof CASE_FILTERS)[number][0];

function Campaign({ id }: { id: string }) {
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const load = () => getCampaign(id).then((value) => { setReport(value); setError(undefined); }).catch(setError).finally(() => setLoading(false));
  useEffect(() => {
    setReport(null);
    setError(undefined);
    setLoading(true);
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [id]);
  const target = report?.targetValidVideos ?? 0;
  const cases = report?.cases ?? [];
  const visible = useMemo(() => cases.filter((item) => {
    if (filter === 'complete') return item.validVideos.length >= target;
    if (filter === 'open') return item.validVideos.length < target;
    return true;
  }), [cases, filter, target]);
  const latest = useMemo(() => cases
    .flatMap((item) => item.validVideos.map((video) => ({ video, title: item.title })))
    .sort((left, right) => (right.video.acceptedAt ?? '').localeCompare(left.video.acceptedAt ?? ''))
    .slice(0, 6), [cases]);
  const totals = report?.totals;
  const contract = report?.validityContract ?? {};
  const allTokens = totals ? totals.tokens.inputTokens + totals.tokens.outputTokens + totals.tokens.reasoningTokens : 0;
  return <main class="campaign-page">
    <section class="hero campaign-hero">
      <div>
        <p class="eyebrow">STRICT-ACCEPTANCE CAMPAIGN</p>
        <h1>{totals ? `${totals.cases} edge cases, ${target} accepted videos each.` : 'Edge-case campaign progress.'}</h1>
        <p>A render counts only when the frozen gate passes, the 3D review marks it <span class="mono">semanticAccepted</span> and <span class="mono">presentationAccepted</span> under the current review contract, and its MP4 hash is new within the case. Everything else stays an attempt—never a result.</p>
      </div>
      <div class="campaign-sync">
        <Chip tone={error ? 'fail' : 'live'}><span class="live-dot" />{error ? 'refresh failing' : 'auto-refresh 30s'}</Chip>
        <p class="mono">{report?.updatedAt ? `report published ${new Date(report.updatedAt).toLocaleTimeString()}` : 'no report yet'}</p>
        <button onClick={load}>Refresh now</button>
      </div>
    </section>
    <ErrorBox error={error} />
    {!report || !totals ? (loading
      ? <div class="empty">Loading campaign report…</div>
      : <div class="empty"><h2>No campaign report yet</h2><p>Results appear once the runner publishes <span class="mono">report.json</span> for <span class="mono">{id}</span>. This page retries every 30 seconds.</p></div>) : <>
      <section class="stat-grid" aria-label="Campaign totals">
        <div class="stat lead">
          <small>Accepted videos</small>
          <b>{plainCount.format(totals.validVideos)}<em>/{plainCount.format(totals.targetVideos)}</em></b>
          <Meter value={totals.validVideos} max={totals.targetVideos} label="Accepted videos against strict target" />
          <span>{totals.targetVideos ? ((totals.validVideos / totals.targetVideos) * 100).toFixed(1) : '0.0'}% of the strict target · {duration(totals.elapsedHours * 3600)} elapsed</span>
        </div>
        <Stat label="Complete cases" value={`${totals.completeCases}/${totals.cases}`} hint={`${target} accepted videos required per case`}>
          <Meter value={totals.completeCases} max={totals.cases} label="Cases at full acceptance" />
        </Stat>
        <Stat label="Jobs submitted" value={plainCount.format(totals.jobs)} hint={`${totals.activeJobs} in flight · ${totals.failedJobs} failed · ${duration(totals.wallS)} job wall time`} />
        <Stat label="Throughput" value={`${totals.validVideosPerHour.toFixed(2)} videos/h`} hint={`${totals.jobsPerHour.toFixed(2)} jobs/h sustained`} />
        <Stat label="Model tokens" value={compactCount.format(allTokens)} hint={`${compactCount.format(totals.tokens.inputTokens)} in · ${compactCount.format(totals.tokens.outputTokens)} out · ${compactCount.format(totals.tokens.reasoningTokens)} reasoning`} />
        <Stat label="Tokens per accepted video" value={totals.meanTokensPerValidVideo == null ? '—' : compactCount.format(totals.meanTokensPerValidVideo)} hint={`${plainCount.format(totals.tokens.calls)} model calls · ${duration(totals.tokens.modelWallS)} model time`} />
      </section>
      <section class="contract-note">
        <p class="eyebrow">VALIDITY CONTRACT</p>
        <div class="chip-row">
          {Object.entries(CONTRACT_LABELS).filter(([key]) => contract[key as keyof CampaignValidityContract] === true).map(([key, label]) => <Chip tone="pass" key={key}>{label}</Chip>)}
          <Chip>≥ {contract.minimumPerCase ?? target} per case</Chip>
        </div>
        <p>Only videos satisfying every clause are playable below. Pending, rejected, and failed attempts appear as status with links to their raw pipeline evidence.</p>
      </section>
      <section>
        <div class="section-title"><div><p class="eyebrow">ACCEPTED RESULTS</p><h2>Latest accepted 3D videos</h2></div><p>Newest acceptances first. Every case keeps its full accepted set in the ledger below.</p></div>
        {latest.length
          ? <div class="job-video-gallery campaign-videos">{latest.map(({ video, title }) => <AcceptedVideo key={video.sha256} video={video} caseTitle={title} heading={title} />)}</div>
          : <div class="empty video-empty"><div class="render-pulse" /><h2>No accepted videos yet</h2><p>{totals.jobs
            ? `${plainCount.format(totals.jobs)} attempts submitted, ${totals.activeJobs} still running. A video appears the moment it clears the gate and brief-aware 3D review.`
            : 'The campaign runner has not submitted its first attempt yet.'}</p></div>}
      </section>
      <section>
        <div class="section-title"><div><p class="eyebrow">CASE LEDGER</p><h2>Per-case progress</h2></div><div class="filter-row" role="group" aria-label="Filter cases">{CASE_FILTERS.map(([value, label]) => <button key={value} class={filter === value ? 'filter on' : 'filter'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
        {visible.length ? <div class="campaign-ledger">{visible.map((item) => <CampaignCaseRow key={item.id} item={item} target={target} />)}</div> : <div class="empty small">No cases match this filter.</div>}
      </section>
    </>}
  </main>;
}

const initial: SubmitPayload = { brief: '', methodology: 'production', engine: 'auto', nScenarios: 3, maps: MAPS.map(([id]) => id), maxSitesPerMap: 3, ambient: 'light', seed: 42, render3d: true, topK: 3, judge: true };
function Submit() {
  const [form, setForm] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const update = <K extends keyof SubmitPayload>(key: K, value: SubmitPayload[K]) => setForm((old) => ({ ...old, [key]: value }));
  const send = async (e: Event) => { e.preventDefault(); setBusy(true); setError(undefined); try { navigate(`#/jobs/${encodeURIComponent(await submitJob(form))}`); } catch (reason) { setError(reason); setBusy(false); } };
  const production = form.methodology === 'production';
  const cellCount = production ? 45 : form.maps.length * form.maxSitesPerMap * form.nScenarios;
  return <main class="submit-page"><button class="back" onClick={() => navigate('#/')}>← Gallery</button><section class="submit-intro"><p class="eyebrow">NEW PIPELINE JOB</p><h1>Author an edge case.</h1><p>Production mode runs the measured development recipe—not a shortened demo path. Expect several minutes for compilation, simulation, judging, and 3D review; visual fallback can take longer.</p></section><ErrorBox error={error} /><form onSubmit={send}>
    <fieldset class="wide"><legend>Run methodology</legend><div class="map-options">
      <label class="check"><input type="radio" name="methodology" checked={production} onChange={() => update('methodology', 'production')} /><span><b>Production recipe</b><small>Research-proven routing, sampling, gate, footage judge, 3D acceptance, and defect-driven fallback.</small></span></label>
      <label class="check"><input type="radio" name="methodology" checked={!production} onChange={() => update('methodology', 'custom')} /><span><b>Custom experiment</b><small>Expose individual controls for debugging and ablations.</small></span></label>
    </div></fieldset>
    <label class="wide"><span>Scenario brief</span><textarea required minlength={12} value={form.brief} onInput={(e) => update('brief', e.currentTarget.value)} placeholder="A delivery van blocks the bike lane just before an intersection as a cyclist approaches…" /></label>
    {production ? <section class="wide methodology-card" aria-label="Production methodology">
      <p class="eyebrow">FROZEN PRODUCTION PROFILE</p><h2>Compiler first. Visual author for structural gaps.</h2>
      <p>The server—not this browser—enforces all five maps, three sites per map, three deterministic draws, light ambient traffic, Sol/low authoring, the unchanged C1–C6 gate, Sol/medium spread-8 footage review, and strict brief-aware 3D acceptance. A rejected compiler result escalates to the visual author; a rejected visual result receives one evidence-driven repair.</p>
      <div class="chip-row"><Chip>5 maps</Chip><Chip>45 cells max</Chip><Chip>light ambient</Chip><Chip>3D top 3</Chip><Chip>visual fallback</Chip></div>
    </section> : <div class="form-grid"><label><span>Engine</span><select value={form.engine} onChange={(e) => update('engine', e.currentTarget.value as SubmitPayload['engine'])}><option value="auto">Auto route</option><option value="compiler">Compiler</option><option value="vista2">Vista2 visual agent</option></select></label>
      <label><span>Scenarios / site</span><input type="number" min="1" max="10" value={form.nScenarios} onInput={(e) => update('nScenarios', e.currentTarget.valueAsNumber)} /></label>
      <label><span>Max sites / map</span><input type="number" min="1" max="10" value={form.maxSitesPerMap} onInput={(e) => update('maxSitesPerMap', e.currentTarget.valueAsNumber)} /></label>
      <label><span>Ambient traffic</span><select value={form.ambient} onChange={(e) => update('ambient', e.currentTarget.value as SubmitPayload['ambient'])}>{['off', 'light', 'moderate', 'city', 'heavy'].map((v) => <option value={v}>{v}</option>)}</select></label>
      <label><span>Seed</span><input type="number" value={form.seed} onInput={(e) => update('seed', e.currentTarget.valueAsNumber)} /></label>
      <fieldset class="wide"><legend>Maps</legend><div class="map-options">{MAPS.map(([id, label]) => <label class="check" key={id}><input type="checkbox" checked={form.maps.includes(id)} onChange={(e) => update('maps', e.currentTarget.checked ? [...form.maps, id] : form.maps.filter((value) => value !== id))} /><span>{label}</span></label>)}</div></fieldset>
      <label class="toggle"><input type="checkbox" checked={form.render3d} onChange={(e) => update('render3d', e.currentTarget.checked)} /><span><b>3D rendering</b><small>Render highest-ranked passing cells</small></span></label>
      <label><span>3D top K</span><input type="number" min="1" max="10" disabled={!form.render3d} value={form.topK} onInput={(e) => update('topK', e.currentTarget.valueAsNumber)} /></label>
      <label class="toggle"><input type="checkbox" checked={form.judge} onChange={(e) => update('judge', e.currentTarget.checked)} /><span><b>Footage judge</b><small>Score realism and dynamism</small></span></label>
    </div>}<div class="submit-actions"><span>{production ? 'Frozen research recipe' : `${form.maps.length} maps`} · up to {cellCount} cells</span><button class="primary" disabled={busy || (!production && !form.maps.length)}>{busy ? 'Submitting…' : 'Start pipeline →'}</button></div>
  </form></main>;
}

function App() {
  const route = useRoute();
  return <><Header />
    {route.view === 'job' ? <JobDetail id={route.id} />
      : route.view === 'campaign' ? <Campaign id={route.id} />
        : route.view === 'submit' ? <Submit /> : <Gallery />}
    <footer>UniScenarios · intermediate outputs preserved stage by stage</footer></>;
}

render(<App />, document.getElementById('app')!);
