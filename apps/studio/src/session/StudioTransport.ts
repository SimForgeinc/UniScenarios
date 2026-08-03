export interface StudioTransportCounters {
  readonly frames: number;
  readonly uiPublishes: number;
  readonly starts: number;
  readonly cancelledFrames: number;
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
  private lastPublish = -Infinity;
  private renderFrame: (time: number) => void = () => undefined;
  private publishTime: (time: number) => void = () => undefined;
  private frames = 0;
  private uiPublishes = 0;
  private starts = 0;
  private cancelledFrames = 0;

  get counters(): StudioTransportCounters {
    return { frames: this.frames, uiPublishes: this.uiPublishes, starts: this.starts, cancelledFrames: this.cancelledFrames };
  }
  get active(): boolean { return this.running; }

  configure(renderFrame: (time: number) => void, publishTime: (time: number) => void): void {
    this.renderFrame = renderFrame;
    this.publishTime = publishTime;
  }

  play(time: number, duration: number): void {
    if (this.running) return;
    this.running = true;
    this.traceStart = time >= duration ? 0 : time;
    this.duration = duration;
    this.wallStart = performance.now();
    this.lastPublish = -Infinity;
    this.starts++;
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.running && !this.raf) return;
    this.running = false;
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
    const time = Math.min(this.duration, this.traceStart + Math.max(0, now - this.wallStart) / 1000);
    this.renderFrame(time);
    this.frames++;
    // 20 Hz is responsive for text/scrubbers and avoids per-frame app renders.
    if (now - this.lastPublish >= 50 || time >= this.duration) {
      this.lastPublish = now;
      this.publishTime(time);
      this.uiPublishes++;
    }
    if (time >= this.duration) {
      this.running = false;
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
