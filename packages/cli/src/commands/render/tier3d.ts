import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { open, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

import { CliError } from '../../errors.js';
import { REPO_ROOT } from '../../maps.js';

export type RenderFormat = 'stills' | 'video' | 'both';

export interface Tier3dRenderOptions {
  readonly tracePath: string;
  readonly instancePath: string;
  readonly outDir: string;
  readonly studioUrl?: string | undefined;
  readonly resultPath?: string | undefined;
  readonly format?: RenderFormat | undefined;
  readonly fps?: number | undefined;
  readonly fullClip?: boolean | undefined;
  readonly composition?: 'all-authored' | 'incident' | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly display?: string | undefined;
  readonly chromeFlags?: readonly string[] | undefined;
}

interface ExportFrame {
  readonly phase: string;
  readonly artifact?: { readonly file?: string } | undefined;
}

interface ExportManifest {
  readonly schema?: string | undefined;
  readonly deterministic?: boolean | undefined;
  readonly mapId?: string | undefined;
  readonly scenarioId?: string | undefined;
  readonly actors?: { readonly count?: number; readonly ids?: readonly string[] } | undefined;
  readonly props?: { readonly count?: number; readonly ids?: readonly string[] } | undefined;
  readonly frames?: readonly ExportFrame[] | undefined;
  readonly video?: {
    readonly file?: string | undefined;
    readonly fps?: number | undefined;
    readonly frameCount?: number | undefined;
    readonly durationSeconds?: number | undefined;
    readonly unavailable?: boolean | undefined;
    readonly reason?: string | undefined;
  } | null | undefined;
  readonly machineAssessment?: { readonly verdict?: string } | undefined;
}

export interface Tier3dRenderResult {
  readonly tier: '3d';
  readonly outDir: string;
  readonly manifest: string;
  readonly mapId: string;
  readonly scenarioId: string;
  readonly phases: readonly { readonly phase: string; readonly file: string }[];
  readonly video: {
    readonly file: string;
    readonly fps: number;
    readonly frameCount: number;
    readonly durationSeconds: number;
  } | null;
  readonly actorCount: number;
  readonly propCount: number;
  readonly studio: { readonly url: string; readonly autoStarted: boolean };
  readonly elapsedSeconds: number;
}

/** P1 render-command dispatch contract. */
export interface Render3dOptions {
  readonly instance: string;
  readonly trace: string;
  readonly out: string;
  readonly format: RenderFormat;
  readonly camera: 'follow-ego' | 'overview';
  readonly fps: number;
  readonly redact: boolean;
  readonly fullClip: boolean;
  readonly composition: 'all-authored' | 'incident';
  readonly devAssets?: string | undefined;
  readonly studioUrl?: string | undefined;
}

export interface Render3dResult extends Tier3dRenderResult {
  readonly status: 'rendered';
  readonly reason: string;
}

interface ManagedProcess {
  readonly child: ChildProcess;
  readonly output: () => string;
  stop(): Promise<void>;
}

const PHASES = ['pre-event', 'reveal', 'conflict', 'aftermath'] as const;
const DEFAULT_CHROME_FLAGS = [
  '--use-gl=angle',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
] as const;

function managedProcess(command: string, args: readonly string[], options: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}): ManagedProcess {
  const chunks: Buffer[] = [];
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    child,
    output: () => Buffer.concat(chunks).toString('utf8').slice(-12_000),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid!, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url: string, processRef: ManagedProcess, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processRef.child.exitCode !== null || processRef.child.signalCode !== null) {
      throw new CliError('studio_start_failed', 'ephemeral Studio server exited before becoming ready', {
        detail: { output: processRef.output() },
      });
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new CliError('studio_start_timeout', `ephemeral Studio server was not ready after ${timeoutMs} ms`, {
    detail: { url, output: processRef.output() },
  });
}

async function startStudio(env: NodeJS.ProcessEnv): Promise<{ url: string; process: ManagedProcess }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const processRef = managedProcess('pnpm', [
    '--dir', path.join(REPO_ROOT, 'apps', 'studio'),
    'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { cwd: REPO_ROOT, env });
  await waitForHttp(url, processRef);
  return { url, process: processRef };
}

async function startXvfb(env: NodeJS.ProcessEnv): Promise<{ display: string; process: ManagedProcess } | null> {
  if (env['DISPLAY']) return null;
  const executable = '/usr/bin/Xvfb';
  if (!existsSync(executable)) {
    throw new CliError('display_unavailable', '3D rendering needs DISPLAY or /usr/bin/Xvfb', {
      detail: { hint: 'install Xvfb or provide DISPLAY' },
    });
  }
  for (let number = 90; number < 200; number += 1) {
    const reservationPath = `/tmp/.uniscenarios-X${number}.lock`;
    let reservation;
    try {
      reservation = await open(reservationPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      if (existsSync(`/tmp/.X${number}-lock`) || existsSync(`/tmp/.X11-unix/X${number}`)) continue;
      const display = `:${number}`;
      const processRef = managedProcess(executable, [
        display, '-screen', '0', '1920x1080x24', '+extension', 'GLX', '+render', '-noreset',
      ], { cwd: REPO_ROOT, env });
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (existsSync(`/tmp/.X11-unix/X${number}`)) return { display, process: processRef };
        if (processRef.child.exitCode !== null || processRef.child.signalCode !== null) break;
        await delay(50);
      }
      await processRef.stop();
    } finally {
      await reservation.close();
      await unlink(reservationPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  throw new CliError('display_unavailable', 'could not allocate an Xvfb display for 3D rendering');
}

export function buildTier3dExporterArgs(options: Tier3dRenderOptions, studioUrl: string): string[] {
  const format = options.format ?? 'both';
  const fps = options.fps ?? 12;
  const width = options.width ?? 1600;
  const height = options.height ?? 960;
  if (!['stills', 'video', 'both'].includes(format)) {
    throw new CliError('bad_value', `--format must be stills | video | both, got ${format}`, { path: '--format' });
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new CliError('bad_value', '--fps must be an integer between 1 and 60', { path: '--fps' });
  }
  for (const [name, value] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(value) || value < 320 || value > 7680) {
      throw new CliError('bad_value', `--${name} must be an integer between 320 and 7680`, { path: `--${name}` });
    }
  }
  const chromeFlags = options.chromeFlags ?? DEFAULT_CHROME_FLAGS;
  return [
    path.join(REPO_ROOT, 'scripts', 'export-render.mjs'),
    '--url', studioUrl,
    '--instance', path.resolve(options.instancePath),
    '--trace', path.resolve(options.tracePath),
    ...(options.resultPath ? ['--result', path.resolve(options.resultPath)] : []),
    '--out', path.resolve(options.outDir),
    '--fps', String(fps),
    '--width', String(width),
    '--height', String(height),
    ...(options.composition === 'incident' ? [] : ['--all-authored']),
    '--camera-search',
    '--pin-page',
    // export-render's intentionally small parser treats a following `--...`
    // token as another boolean flag. Send names without the prefix and let the
    // exporter normalize them back to Chrome arguments.
    '--chrome-flags', chromeFlags.map((flag) => flag.replace(/^--/, '')).join(','),
    ...(options.fullClip ? ['--full-clip'] : []),
    ...(format === 'stills' ? ['--no-video'] : []),
  ];
}

export function assertTier3dManifest(manifest: ExportManifest, format: RenderFormat): void {
  const actualPhases = (manifest.frames ?? []).map((frame) => frame.phase);
  if (actualPhases.length !== PHASES.length || PHASES.some((phase, index) => actualPhases[index] !== phase)) {
    throw new CliError('render_incomplete', '3D exporter did not produce the four deterministic incident phases', {
      detail: { expected: PHASES, actual: actualPhases },
    });
  }
  if (manifest.deterministic !== true || manifest.machineAssessment?.verdict !== 'pass') {
    throw new CliError('render_rejected', '3D render manifest failed deterministic machine assessment', {
      detail: { deterministic: manifest.deterministic, verdict: manifest.machineAssessment?.verdict },
    });
  }
  if (format !== 'stills' && (!manifest.video?.file || manifest.video.unavailable)) {
    throw new CliError('render_incomplete', '3D exporter did not produce the requested H.264 video', {
      detail: { video: manifest.video },
    });
  }
}

async function runExporter(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new CliError('render_failed', `3D exporter exited with ${signal ?? code ?? 'unknown status'}`, {
        detail: {
          stdout: Buffer.concat(stdout).toString('utf8').slice(-8_000),
          stderr: Buffer.concat(stderr).toString('utf8').slice(-12_000),
        },
      }));
    });
  });
}

/** Render four incident phases and an optional H.264 clip through the real Studio renderer. */
export async function renderTier3d(options: Tier3dRenderOptions): Promise<Tier3dRenderResult> {
  for (const [name, file] of [['instance', options.instancePath], ['trace', options.tracePath]] as const) {
    if (!existsSync(path.resolve(file))) {
      throw new CliError('file_not_found', `${name} file does not exist: ${file}`, { path: file });
    }
  }
  const startedAt = performance.now();
  const env: NodeJS.ProcessEnv = { ...process.env };
  const xvfb = options.display || env['DISPLAY']
    ? null
    : await startXvfb(env);
  env['DISPLAY'] = options.display ?? env['DISPLAY'] ?? xvfb?.display;
  const nvidiaIcd = '/usr/share/vulkan/icd.d/nvidia_icd.json';
  if (!env['VK_ICD_FILENAMES'] && existsSync(nvidiaIcd)) env['VK_ICD_FILENAMES'] = nvidiaIcd;

  let studio: { url: string; process: ManagedProcess } | null = null;
  try {
    if (!options.studioUrl) studio = await startStudio(env);
    const studioUrl = options.studioUrl ?? studio!.url;
    await runExporter(buildTier3dExporterArgs(options, studioUrl), env);
    const manifestFile = path.resolve(options.outDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as ExportManifest;
    const format = options.format ?? 'both';
    assertTier3dManifest(manifest, format);
    const phases = manifest.frames!.map((frame) => ({
      phase: frame.phase,
      file: path.resolve(options.outDir, frame.artifact!.file!),
    }));
    return {
      tier: '3d',
      outDir: path.resolve(options.outDir),
      manifest: manifestFile,
      mapId: manifest.mapId!,
      scenarioId: manifest.scenarioId!,
      phases,
      video: format === 'stills' ? null : {
        file: path.resolve(options.outDir, manifest.video!.file!),
        fps: manifest.video!.fps!,
        frameCount: manifest.video!.frameCount!,
        durationSeconds: manifest.video!.durationSeconds!,
      },
      actorCount: manifest.actors?.count ?? manifest.actors?.ids?.length ?? 0,
      propCount: manifest.props?.count ?? manifest.props?.ids?.length ?? 0,
      studio: { url: studioUrl, autoStarted: studio !== null },
      elapsedSeconds: (performance.now() - startedAt) / 1_000,
    };
  } finally {
    await studio?.process.stop();
    await xvfb?.process.stop();
  }
}

/** Adapter for the first-class `uniscenarios render` dispatch seam. */
export async function render3d(options: Render3dOptions): Promise<Render3dResult> {
  const result = await renderTier3d({
    instancePath: options.instance,
    tracePath: options.trace,
    outDir: options.out,
    studioUrl: options.studioUrl,
    format: options.format,
    fps: options.fps,
    fullClip: options.fullClip,
    composition: options.composition,
  });
  return {
    ...result,
    status: 'rendered',
    reason: `${options.fullClip ? 'full clip' : 'four phases'}${result.video ? ` + H.264 ${result.video.fps} fps video` : ''}`,
  };
}
