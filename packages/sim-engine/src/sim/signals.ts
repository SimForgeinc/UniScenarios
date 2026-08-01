/**
 * Signal programs: a repeating phase timeline per signal id, plus the stop-line
 * arc lengths it controls.
 *
 * The engine does not read signal geometry from the map — `signalPrograms` on
 * `SimScenarioInput` carries everything, so an adapter can bind a template's
 * `signal:*` references to whatever the site actually has (or synthesise a
 * program for an unsignalised study).
 *
 * The timeline starts at `t = -warmupSeconds + offsetS`, so a program is
 * already mid-cycle when the recorded clip begins — actors never see an
 * unnaturally fresh cycle at `t = 0`.
 */

import type { LaneRsl } from '../map/topology.js';
import type { SignalProgram } from '../schema/input.js';

export type SignalPhase = 'green' | 'yellow' | 'red';

export interface StopLineBinding {
  readonly signalId: string;
  readonly rsl: LaneRsl;
  /** Arc length in the lane's **storage** direction. */
  readonly s: number;
}

export class SignalBook {
  private readonly programs: SignalProgram[];
  private readonly byId = new Map<string, SignalProgram>();
  private readonly cycleLength = new Map<string, number>();
  readonly stopLines: StopLineBinding[] = [];
  private readonly stopLinesByLane = new Map<LaneRsl, StopLineBinding[]>();

  constructor(programs: readonly SignalProgram[], private readonly warmupSeconds: number) {
    this.programs = [...programs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const p of this.programs) {
      this.byId.set(p.id, p);
      this.cycleLength.set(
        p.id,
        p.phases.reduce((sum, ph) => sum + ph.durationS, 0),
      );
      for (const sl of [...p.stopLines].sort((a, b) => (a.rsl < b.rsl ? -1 : a.rsl > b.rsl ? 1 : a.s - b.s))) {
        const binding: StopLineBinding = { signalId: p.id, rsl: sl.rsl, s: sl.s };
        this.stopLines.push(binding);
        const arr = this.stopLinesByLane.get(sl.rsl);
        if (arr) arr.push(binding);
        else this.stopLinesByLane.set(sl.rsl, [binding]);
      }
    }
  }

  get isEmpty(): boolean {
    return this.programs.length === 0;
  }

  ids(): string[] {
    return this.programs.map((p) => p.id);
  }

  /** Phase of `signalId` at simulation time `t` (which may be negative). */
  phaseAt(signalId: string, t: number): SignalPhase | null {
    const p = this.byId.get(signalId);
    if (!p) return null;
    const cycle = this.cycleLength.get(signalId)!;
    let elapsed = t + this.warmupSeconds + p.offsetS;
    if (p.loop) {
      elapsed = ((elapsed % cycle) + cycle) % cycle;
    } else if (elapsed < 0) {
      return p.phases[0]!.phase;
    } else if (elapsed >= cycle) {
      return p.phases[p.phases.length - 1]!.phase;
    }
    let acc = 0;
    for (const ph of p.phases) {
      acc += ph.durationS;
      if (elapsed < acc) return ph.phase;
    }
    return p.phases[p.phases.length - 1]!.phase;
  }

  /** Stop lines on a lane, in storage-`s` order. */
  onLane(rsl: LaneRsl): readonly StopLineBinding[] {
    return this.stopLinesByLane.get(rsl) ?? [];
  }
}

/** May an actor enter the intersection on this phase? Yellow is treated as
 * "stop if you comfortably can", which the governor resolves with the
 * comfort-decel test rather than here. */
export function phaseForbidsEntry(phase: SignalPhase): boolean {
  return phase !== 'green';
}
