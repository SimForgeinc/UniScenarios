"use client";

export interface StudioTransportCounters {
  readonly frames: number;
  readonly uiPublishes: number;
  readonly starts: number;
  readonly cancelledFrames: number;
  readonly underruns: number;
  readonly underrunFrames: number;
}

/**
 * The sole clock for authored Studio playback. It renders at display cadence,
 * while publishing timeline state at a deliberately lower cadence so React is
 * never part of the animation path.
 */
export class StudioTransport {
  private raf = 0;
  private running = false;
  private wallStart = 0;
  private traceStart = 0;
  private duration = 0;
  private loopStart = 0;
  private loop = false;
  private lastPublish = -Infinity;
  private renderFrame: (time: number) => void = () => undefined;
  private publishTime: (time: number) => void = () => undefined;
  private playableUntil: () => number = () => Infinity;
  private frames = 0;
  private uiPublishes = 0;
  private starts = 0;
  private cancelledFrames = 0;
  private underruns = 0;
  private underrunFrames = 0;
  private underrunning = false;

  get counters(): StudioTransportCounters {
    return { frames: this.frames, uiPublishes: this.uiPublishes, starts: this.starts, cancelledFrames: this.cancelledFrames, underruns: this.underruns, underrunFrames: this.underrunFrames };
  }
  get active(): boolean { return this.running; }

  configure(renderFrame: (time: number) => void, publishTime: (time: number) => void, playableUntil: () => number = () => Infinity): void {
    this.renderFrame = renderFrame;
    this.publishTime = publishTime;
    this.playableUntil = playableUntil;
  }

  play(time: number, duration: number, options: { loop?: boolean; startTime?: number } = {}): void {
    if (this.running) return;
    this.running = true;
    this.loopStart = options.startTime ?? 0;
    this.traceStart = time >= duration ? this.loopStart : time;
    this.duration = duration;
    this.loop = options.loop ?? false;
    this.wallStart = performance.now();
    this.lastPublish = -Infinity;
    this.starts++;
    // The compiled world already contains t=0. Hand it to the renderer and UI
    // in the initiating turn instead of waiting for a worker lead and a RAF.
    this.renderFrame(this.traceStart);
    this.publishTime(this.traceStart);
    this.uiPublishes++;
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.running && !this.raf) return;
    this.running = false;
    this.underrunning = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.cancelledFrames++;
    }
    this.raf = 0;
  }

  seek(time: number): void {
    this.renderFrame(time);
    if (this.running) {
      this.traceStart = time;
      this.wallStart = performance.now();
    }
  }

  dispose(): void { this.pause(); }

  private tick = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.max(0, now - this.wallStart) / 1000;
    const unbounded = this.traceStart + elapsed;
    const span = this.duration - this.loopStart;
    const desired = this.loop && span > 0 && unbounded >= this.duration
      ? this.loopStart + ((unbounded - this.loopStart) % span)
      : Math.min(this.duration, unbounded);
    const time = Math.min(desired, this.playableUntil());
    if (time + 1e-9 < desired) {
      this.underrunFrames++;
      if (!this.underrunning) this.underruns++;
      this.underrunning = true;
      // Freeze the one authoritative playhead at the recorded edge. Rebasing
      // prevents a slow producer from causing a jump when data arrives.
      this.traceStart = time;
      this.wallStart = now;
    } else {
      this.underrunning = false;
    }
    this.renderFrame(time);
    this.frames++;
    // 20 Hz is responsive for text/scrubbers and avoids per-frame app renders.
    if (now - this.lastPublish >= 50 || time >= this.duration) {
      this.lastPublish = now;
      this.publishTime(time);
      this.uiPublishes++;
    }
    if (!this.loop && time >= this.duration) {
      this.running = false;
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
