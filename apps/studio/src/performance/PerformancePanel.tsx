import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BenchResult, CityViewer, RendererCapability, SurfaceMaterialProfile, SurfaceMaterialReport } from '@uniscenarios/city-renderer';
import type { MapOverlayHandle } from '../mapOverlays';
import {
  QUALITY_PRESETS,
  loadQualityPreference,
  preferenceForPreset,
  saveQualityPreference,
  type QualityPreference,
  type QualityPresetId,
} from './quality';
import { loadSurfaceProfile, saveSurfaceProfile } from './surfacePreference';

interface ComparisonResult { preset: Exclude<QualityPresetId, 'custom'>; label: string; benchmark: BenchResult }

export function PerformancePanel({ viewer, overlays = null, actorCount = 0, defaultOpen = false, diagnosticsEnabled = false }: { viewer: CityViewer | null; overlays?: MapOverlayHandle | null; actorCount?: number; defaultOpen?: boolean; diagnosticsEnabled?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [preference, setPreference] = useState<QualityPreference>(() => loadQualityPreference());
  const [benchmark, setBenchmark] = useState<BenchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult[]>([]);
  const [capability, setCapability] = useState<RendererCapability | null>(null);
  const [surfaceProfile, setSurfaceProfile] = useState<SurfaceMaterialProfile>(() => loadSurfaceProfile());
  const [surfaceReport, setSurfaceReport] = useState<SurfaceMaterialReport | null>(null);

  useEffect(() => {
    if (!viewer) return;
    viewer.setLiveQuality(preference.live);
    viewer.setRenderingSuspended(!preference.runtime.renderScene);
    viewer.setUltraLowFidelity(preference.runtime.ultraLow3d);
    viewer.setLayerVisible('vegetation', preference.runtime.vegetation);
  }, [viewer, overlays, preference]);

  useEffect(() => {
    if (!viewer) return;
    setSurfaceReport(viewer.setSurfaceMaterialProfile(surfaceProfile));
  }, [viewer, surfaceProfile]);

  useEffect(() => {
    if (!viewer || !diagnosticsEnabled) return;
    const refresh = (): void => setSurfaceReport(viewer.getSurfaceMaterialReport());
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [viewer, diagnosticsEnabled]);

  useEffect(() => {
    if (!viewer) return;
    const detected = viewer.getRendererCapability();
    setCapability(detected);
    if (detected.software && preference.runtime.renderScene) {
      const next = preferenceForPreset('ultra-low-3d');
      setPreference(next);
      saveQualityPreference(next);
    }
  }, [viewer]);

  const persist = (next: QualityPreference): void => {
    setPreference(next);
    saveQualityPreference(next);
  };

  const choosePreset = (id: QualityPresetId): void => {
    if (id === 'custom') {
      persist({ ...preference, preset: 'custom' });
      return;
    }
    persist(preferenceForPreset(id));
  };

  const custom = (key: keyof QualityPreference['live'], value: number): void => {
    persist({ ...preference, preset: 'custom', live: { ...preference.live, [key]: value } });
  };

  const apply = (next: QualityPreference): void => {
    if (!viewer) return;
    viewer.setLiveQuality(next.live);
    viewer.setRenderingSuspended(!next.runtime.renderScene);
    viewer.setUltraLowFidelity(next.runtime.ultraLow3d);
    viewer.setLayerVisible('vegetation', next.runtime.vegetation);
  };

  const compareModes = async (): Promise<void> => {
    if (!viewer) return;
    const original = preference;
    const results: ComparisonResult[] = [];
    setRunning(true);
    setComparison([]);
    try {
      const orderedPresets = [
        ...QUALITY_PRESETS.filter((preset) => preset.id !== 'simulation-only'),
        ...QUALITY_PRESETS.filter((preset) => preset.id === 'simulation-only'),
      ];
      for (const preset of orderedPresets) {
        const next = preferenceForPreset(preset.id);
        apply(next);
        const benchmarkResult = await viewer.runBenchmark(4000);
        results.push({ preset: preset.id, label: preset.label, benchmark: benchmarkResult });
        setComparison([...results]);
      }
    } finally {
      apply(original);
      setRunning(false);
    }
  };

  const download = (): void => {
    if (!benchmark && comparison.length === 0) return;
    const blob = new Blob([JSON.stringify({ quality: preference, actorCount, benchmark, comparison }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const capturedAt = benchmark?.capturedAt ?? comparison[0]?.benchmark.capturedAt ?? new Date().toISOString();
    anchor.download = `uniscenarios-benchmark-${capturedAt.replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.root} data-testid="rendering-quality-panel">
      <button type="button" style={styles.disclosure} onClick={() => setOpen(!open)}>
        <span>Rendering quality</span><span>{preference.preset} {open ? '⌃' : '⌄'}</span>
      </button>
      {open ? (
        <div style={styles.body}>
          <label style={styles.label}>
            Quality preset
            <select
              style={styles.select}
              value={preference.preset}
              onChange={(event) => choosePreset(event.target.value as QualityPresetId)}
            >
              {QUALITY_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              <option value="custom">Custom</option>
            </select>
          </label>
          <div style={styles.hint}>
            {preference.preset === 'custom'
              ? 'Custom authoring settings.'
              : QUALITY_PRESETS.find((preset) => preset.id === preference.preset)?.description}
          </div>
          <label style={styles.label}>
            Surface materials
            <select
              style={styles.select}
              value={surfaceProfile}
              data-testid="surface-material-profile"
              onChange={(event) => {
                const next = event.target.value as SurfaceMaterialProfile;
                setSurfaceProfile(next);
                saveSurfaceProfile(next);
              }}
            >
              <option value="original">Original map materials</option>
              <option value="enhanced">Enhanced authoring</option>
              <option value="presentation">Presentation detail</option>
            </select>
          </label>
          <div style={styles.hint}>
            Visual-only, metre-scaled surface detail. Lane markings and unrecognized materials remain original.
          </div>
          {diagnosticsEnabled && surfaceReport ? (
            <div style={styles.liveNote} data-testid="surface-material-report">
              {surfaceReport.enhancedMaterials} enhanced · {surfaceReport.preservedMarkings} markings preserved · {surfaceReport.unknownMaterials} unknown unchanged · {surfaceReport.lastApplyMs.toFixed(2)} ms
            </div>
          ) : null}
          {capability ? <div style={capability.software ? styles.warning : styles.liveNote}>
            {capability.software ? `Software WebGL detected (${capability.renderer}); Ultra Low 3D was selected automatically.` : `Renderer: ${capability.renderer}`}
          </div> : null}
          {preference.runtime.renderScene ? <>
          <Range label="Viewport scale" value={preference.live.maxPixelRatio} min={0.5} max={2.5} step={0.25} onChange={(v) => custom('maxPixelRatio', v)} />
          <Range label="Scene detail" value={100000 / preference.live.maxScreenSpaceError} min={20} max={850} step={10} display={`${Math.round(100000 / preference.live.maxScreenSpaceError)}`} onChange={(v) => custom('maxScreenSpaceError', 100000 / v)} />
          <Range label="Vegetation range" value={preference.live.vegetationMaxDistance} min={0} max={600} step={20} display={`${preference.live.vegetationMaxDistance.toFixed(0)} m`} onChange={(v) => custom('vegetationMaxDistance', v)} />
          <Range label="Streaming pace" value={preference.live.uploadBudgetMs} min={1} max={10} step={1} display={`${preference.live.uploadBudgetMs.toFixed(0)} ms`} onChange={(v) => custom('uploadBudgetMs', v)} />
          <div style={styles.liveNote}>These controls apply live. Anti-aliasing changes apply when the map is reopened.</div>
          </> : <div style={styles.suspended}>Viewport rendering is off. Simulation, timeline, validation, and metrics continue running.</div>}
          {diagnosticsEnabled ? <>
          <button
            type="button"
            style={styles.action}
            disabled={!viewer || running}
            onClick={() => {
              if (!viewer) return;
              setRunning(true);
              void viewer.runBenchmark().then(setBenchmark).finally(() => setRunning(false));
            }}
          >
            {running ? 'Measuring…' : preference.runtime.renderScene ? 'Measure frame pacing' : 'Measure simulation throughput'}
          </button>
          <button type="button" style={styles.action} disabled={!viewer || running} onClick={() => void compareModes()}>
            {running && comparison.length > 0 ? `Comparing ${comparison.length}/${QUALITY_PRESETS.length}…` : 'Compare all modes (about 25s)'}
          </button>
          <div style={styles.liveNote}>Mode comparison is a sequential warm-cache authoring test; use the JSON export for exact counters and phase timings.</div>
          {benchmark ? (
            <div style={styles.result} data-testid="benchmark-result">
              <div>p50 {benchmark.p50FrameMs.toFixed(1)} · p95 {benchmark.p95FrameMs.toFixed(1)} · p99 {benchmark.p99FrameMs.toFixed(1)} ms</div>
              <div>Longest {benchmark.maxFrameMs.toFixed(1)} ms · &gt;33 ms {benchmark.frameTimeCounts.over33_3}</div>
              <div>{actorCount} actors · CPU proxy {benchmark.cpuUtilizationProxy.toFixed(0)}%</div>
              <button type="button" style={styles.link} onClick={download}>Download report</button>
            </div>
          ) : null}
          {comparison.length > 0 ? <div style={styles.result} data-testid="benchmark-comparison">
            {comparison.map((result) => <div key={result.preset} style={styles.compareRow}>
              <span>{result.label}</span>
              <span>{result.benchmark.displayFps.toFixed(0)} UI Hz · p95 {result.benchmark.uiFrameP95Ms.toFixed(1)} ms</span>
            </div>)}
            {!running ? <button type="button" style={styles.link} onClick={download}>Download comparison</button> : null}
          </div> : null}
          </> : null}
        </div>
      ) : null}
    </div>
  );
}

function Range({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display?: string; onChange: (value: number) => void }): JSX.Element {
  return <label style={styles.range}><span>{label}<b>{display ?? value.toFixed(2)}</b></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

const styles: Record<string, CSSProperties> = {
  root: { marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 },
  disclosure: { width: '100%', display: 'flex', justifyContent: 'space-between', border: 0, padding: '3px 0', background: 'transparent', color: '#d9dee8', font: 'inherit', cursor: 'pointer', textTransform: 'capitalize' },
  body: { paddingTop: 8 },
  label: { display: 'grid', gap: 4, color: '#8f98a6', fontSize: 11 },
  select: { width: '100%', padding: '6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.13)', background: '#171b22', color: '#edf1f7', font: 'inherit' },
  hint: { margin: '6px 0 10px', color: '#707a89', fontSize: 11 },
  range: { display: 'grid', gap: 1, margin: '7px 0', color: '#9da6b5', fontSize: 11 },
  action: { width: '100%', marginTop: 8, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.13)', background: 'rgba(255,255,255,0.05)', color: '#edf1f7', font: 'inherit', cursor: 'pointer' },
  liveNote: { color: '#697383', fontSize: 10, lineHeight: 1.35 },
  suspended: { margin: '9px 0', padding: 8, borderRadius: 6, background: 'rgba(47,109,246,0.14)', color: '#b9ccff', fontSize: 11 },
  warning: { margin: '6px 0', color: '#ffbd70', fontSize: 10 },
  result: { marginTop: 8, padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.22)', color: '#b8c0cd', fontSize: 10, fontVariantNumeric: 'tabular-nums' },
  link: { marginTop: 5, padding: 0, border: 0, background: 'transparent', color: '#79a7ff', font: 'inherit', cursor: 'pointer' },
  compareRow: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' },
};
